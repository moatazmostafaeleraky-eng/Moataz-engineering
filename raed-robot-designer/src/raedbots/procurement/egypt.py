from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo
from html import escape

from raedbots.domain.models import BomLine


def procurement_rows(lines: list[BomLine], governorate: str | None) -> list[dict]:
    """Do not invent Egyptian phones, prices, or URLs. Record search gaps explicitly."""
    today = datetime.now(ZoneInfo("Africa/Cairo")).date().isoformat()
    rows = []
    for line in lines:
        if line.make_buy.value != "buy" or line.parent is None:
            continue
        rows.append(
            {
                "bom_item": line.item,
                "part_number": line.part_number,
                "revision": line.revision,
                "name": line.description,
                "manufacturer": line.manufacturer,
                "model": line.model,
                "qty": line.qty,
                "unit": line.unit,
                "cad_status": line.cad_match.value if line.cad_match else None,
                "egypt_stock": "No live local supplier search performed for this item",
                "egypt_city": None,
                "egypt_address": None,
                "egypt_phone": None,
                "egypt_url": None,
                "import_section": "Separate import-supplier research required; no live lookup performed in this release",
                "price_egp": None,
                "price_original": None,
                "currency": None,
                "availability": "Quotation required",
                "checked_on": None,
                "report_generated_on": today,
                "search_status": "not_searched_live",
                "delivery_governorate": governorate,
                "decision": "No documented supplier; no assumed link or price",
                "notes": line.notes,
            }
        )
    return rows


def html_report(rows: list[dict]) -> str:
    tr = []
    for r in rows:
        tr.append(
            "<tr>"
            + "".join(
                f"<td>{escape(str(r.get(k))) if r.get(k) is not None else '—'}</td>"
                for k in (
                    "part_number",
                    "manufacturer",
                    "model",
                    "qty",
                    "egypt_stock",
                    "import_section",
                    "price_egp",
                    "decision",
                )
            )
            + "</tr>"
        )
    return f"""<!doctype html><html lang="en" dir="ltr"><meta charset="utf-8">
<title>Procurement report — Egypt</title>
<style>body{{font-family:Tahoma,sans-serif;padding:24px}} table{{border-collapse:collapse;width:100%}}
td,th{{border:1px solid #ccc;padding:6px;font-size:13px}} th{{background:#111;color:#fff}}</style>
<h1>Procurement report (delivery market: Egypt)</h1>
<p>Base currency: EGP. Unknown prices are not zero. An overseas supplier shipping to Egypt is not a local supplier.</p>
<table><thead><tr><th>Part</th><th>Manufacturer</th><th>Model</th><th>Quantity</th><th>Local</th><th>Import</th><th>EGP</th><th>Decision</th></tr></thead>
<tbody>{''.join(tr)}</tbody></table>
<p>Generated: {escape(str(rows[0]['report_generated_on'])) if rows else ''}</p>
</html>"""
