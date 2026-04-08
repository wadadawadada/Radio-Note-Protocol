import base64
import json
import os
import sys
import traceback
from typing import Any


def emit(event_type: str, payload: dict[str, Any]) -> None:
    payload = {"type": event_type, **payload}
    line = json.dumps(payload, ensure_ascii=True) + "\n"
    sys.stdout.buffer.write(line.encode("utf-8"))
    sys.stdout.buffer.flush()


def repair_text(value: Any) -> str:
    try:
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return str(value or "")
    except Exception:
        return ""


def format_node_id(node_num: Any) -> str | None:
    try:
        return f"!{int(node_num) & 0xFFFFFFFF:08x}"
    except Exception:
        return None


def describe_port(port: Any) -> dict[str, Any]:
    return {
        "device": repair_text(getattr(port, "device", "")),
        "description": repair_text(getattr(port, "description", "")),
        "manufacturer": repair_text(getattr(port, "manufacturer", "")),
        "serialNumber": repair_text(getattr(port, "serial_number", "")),
    }


def list_ports() -> list[dict[str, Any]]:
    try:
        from serial.tools import list_ports as serial_list_ports  # type: ignore
    except Exception:
        return []
    return [describe_port(port) for port in serial_list_ports.comports()]


def resolve_channel_index(packet: dict[str, Any], decoded: dict[str, Any]) -> int:
    for key in ("channel", "channelIndex"):
        value = packet.get(key, decoded.get(key))
        if value is None:
            continue
        try:
            return max(0, min(7, int(value)))
        except Exception:
            continue
    return 0


def snapshot_nodes(interface: Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    nodes = getattr(interface, "nodes", {}) or {}
    for _, node in nodes.items():
        node_id = repair_text(node.get("user", {}).get("id") or node.get("id") or "") or format_node_id(node.get("num")) or ""
        result.append(
            {
                "id": node_id,
                "name": repair_text(node.get("user", {}).get("longName") or node.get("user", {}).get("shortName") or node_id),
                "shortName": repair_text(node.get("user", {}).get("shortName") or ""),
                "online": True,
                "lastHeard": node.get("lastHeard") or None,
                "snr": node.get("snr") or node.get("rxSnr"),
            }
        )
    return sorted(result, key=lambda item: str(item.get("name") or ""))


def main() -> None:
    try:
        from pubsub import pub  # type: ignore
        from meshtastic.serial_interface import SerialInterface  # type: ignore
    except Exception as exc:
        emit(
            "status",
            {
                "connected": False,
                "mode": "error",
                "error": f"Missing Python deps: {exc}",
                "ports": list_ports(),
                "selectedPort": os.environ.get("MESHTASTIC_PORT", ""),
                "localNodeId": None,
            },
        )
        return

    selected_port = os.environ.get("MESHTASTIC_PORT", "").strip() or None
    current_ports = list_ports()
    resolved_port = selected_port or (current_ports[0]["device"] if current_ports else None)
    interface = None

    try:
        if not resolved_port:
            emit(
                "status",
                {
                    "connected": False,
                    "mode": "offline",
                    "error": "No Meshtastic serial port detected",
                    "ports": current_ports,
                    "selectedPort": selected_port,
                    "localNodeId": None,
                },
            )
            return

        interface = SerialInterface(devPath=resolved_port)
        local_node_num = getattr(getattr(interface, "myInfo", None), "my_node_num", None)
        emit(
            "status",
            {
                "connected": True,
                "mode": "serial",
                "error": None,
                "ports": list_ports(),
                "selectedPort": resolved_port,
                "localNodeId": format_node_id(local_node_num),
            },
        )
        emit("nodes", {"nodes": snapshot_nodes(interface)})
    except Exception as exc:
        emit(
            "status",
            {
                "connected": False,
                "mode": "error",
                "error": f"Meshtastic connect failed: {exc}",
                "ports": list_ports(),
                "selectedPort": resolved_port,
                "localNodeId": None,
            },
        )
        return

    def on_receive(packet: dict[str, Any], interface: Any | None = None, topic: Any | None = None, **kwargs: Any) -> None:
        decoded = packet.get("decoded", {}) or {}
        raw_text = decoded.get("text")
        text = repair_text(raw_text)
        if not text:
            return
        sender = repair_text(packet.get("fromId") or packet.get("from") or format_node_id(packet.get("from")))
        recipient = repair_text(packet.get("toId") or packet.get("to") or "local")
        is_direct = recipient not in ("^all", "all", "broadcast")
        emit(
            "message",
            {
                "sender": sender,
                "recipient": recipient,
                "text": text,
                "channelIndex": resolve_channel_index(packet, decoded),
                "isDirectMessage": is_direct,
            },
        )

    pub.subscribe(on_receive, "meshtastic.receive")

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            emit("error", {"message": "invalid json from stdin"})
            continue

        try:
            msg_type = message.get("type")
            payload = message.get("payload", {}) or {}

            if msg_type == "refresh_nodes":
                emit("nodes", {"nodes": snapshot_nodes(interface)})
                emit(
                    "status",
                    {
                        "connected": True,
                        "mode": "serial",
                        "error": None,
                        "ports": list_ports(),
                        "selectedPort": resolved_port,
                        "localNodeId": format_node_id(getattr(getattr(interface, "myInfo", None), "my_node_num", None)),
                    },
                )
                continue

            if msg_type != "send_text":
                continue

            text = repair_text(payload.get("text") or "")
            if payload.get("textBase64"):
                text = base64.b64decode(str(payload.get("textBase64"))).decode("utf-8")
            channel_index = max(0, min(7, int(payload.get("channelIndex", 0) or 0)))
            send_kwargs = {
                "text": text,
                "destinationId": repair_text(payload.get("destinationId") or ""),
                "wantAck": bool(payload.get("wantAck")),
                "channelIndex": channel_index,
            }
            packet = None
            try:
                packet = interface.sendText(**send_kwargs)
            except TypeError:
                send_kwargs.pop("channelIndex", None)
                packet = interface.sendText(**send_kwargs)

            emit(
                "sent",
                {
                    "destinationId": send_kwargs["destinationId"],
                    "text": text,
                    "channelIndex": channel_index,
                    "packetId": getattr(packet, "id", None),
                    "clientMsgId": payload.get("clientMsgId"),
                },
            )
        except Exception as exc:
            emit("error", {"message": f"send failed: {exc}", "trace": traceback.format_exc(limit=1)})


if __name__ == "__main__":
    main()
