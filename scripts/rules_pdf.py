"""Convierte bases PDF en apartados, párrafos y tablas para el visor de la web."""
from collections import Counter
import re

import pdfplumber


def clean(text):
    return re.sub(r"\s+", " ", (text or "").replace("\uf0b7", "•")).strip()


TOPICS = re.compile(r"^(?:ámbito|participantes|fecha|tiempo|lugar|local|sistema|ritmo|inscripci[oó]n(?:es)?|premios|desempates|reglas|condiciones|horario|calendario|cuotas|admisión|reclamaciones|equipo|contacto|puntuación|descansos|orden|ranking|normas|torneo|retirada|descalificaciones|organización|emparejamiento|árbitro|móviles|otros|aceptación|resultados|válido|solicitud|retrasos|dispositivos|anotación|comité)\b", re.I)


def table_block(table):
    """Descarta los bordes decorativos y conserva las cabeceras combinadas."""
    edges = sorted(set(round(x, 2) for cell in table.cells for x in (cell[0], cell[2])))
    centers = [(a + b) / 2 for a, b in zip(edges, edges[1:]) if b - a >= 8]
    if len(centers) < 2:
        return None
    rows = []
    for geometry, values in zip(table.rows, table.extract()):
        row, position = [], 0
        for bbox, value in zip(geometry.cells, values):
            if bbox is None:
                continue
            covered = [i for i, x in enumerate(centers) if bbox[0] - .1 <= x <= bbox[2] + .1]
            if not covered:
                continue
            while position < covered[0]:
                row.append({"text": "", "span": 1})
                position += 1
            row.append({"text": clean(value), "span": len(covered)})
            position = covered[-1] + 1
        while position < len(centers):
            row.append({"text": "", "span": 1})
            position += 1
        if any(c["text"] for c in row):
            rows.append(row)
    if len(rows) < 2:
        return None
    data = re.compile(r"\d{1,2}[:.]\d{2}|\d+[ºª]|\d[\d.,]*\s*€")
    header = bool(rows and not any(data.search(c["text"]) for c in rows[0]))
    # Algunas cabeceras se cortan en dos filas por las líneas del propio PDF.
    if header and len(rows) > 1 and not any(data.search(c["text"]) for c in rows[1]):
        previous = {}
        start = 0
        for cell in rows[0]:
            previous[(start, cell["span"])] = cell
            start += cell["span"]
        start, merged = 0, True
        for cell in rows[1]:
            if cell["text"]:
                target = previous.get((start, cell["span"]))
                if target is None:
                    merged = False
                    break
                target["text"] = clean(target["text"] + " " + cell["text"])
            start += cell["span"]
        if merged:
            rows.pop(1)
    return {"type": "table", "rows": rows, "header": header}


def heading(line, body_size, intro):
    text = clean(line["text"])
    numbered = re.match(r"^(\d{1,2})(?:[.)]+|[ºª])\s+(.+)$", text)
    size = max((c["size"] for c in line["chars"] if c["text"].strip()), default=body_size)
    if numbered:
        label = numbered[2]
        colon = re.match(r"^([^:]{2,90}):\s*(.*)$", label)
        if colon and (TOPICS.match(colon[1]) or any("bold" in c["fontname"].lower() for c in line["chars"][:15])):
            return numbered[1], colon[1], colon[2]
        if len(label) < 105 and (size > body_size * 1.08 or (TOPICS.match(label) and label.endswith("."))):
            return numbered[1], label.rstrip("."), ""
    prefix = re.match(r"^([^:]{2,50}):\s*(.*)$", text)
    if prefix and TOPICS.match(prefix[1]) and not re.match(r"^(?:Supra|Ronda)\b", text, re.I):
        return "", prefix[1], prefix[2]
    letters = re.sub(r"[^a-záéíóúüñ]", "", text, flags=re.I)
    capitals = sum(c.isupper() for c in letters) / max(len(letters), 1)
    if not intro and len(text) < 145 and size > body_size * 1.12 and (capitals > .65 or text.startswith("HOTEL ")):
        return "", text, ""
    return None


def extract_rules_pdf(path):
    with pdfplumber.open(path) as pdf:
        pages = [(page, page.extract_text_lines(return_chars=True)) for page in pdf.pages]
        sizes = Counter(round(c["size"], 1) for page, _ in pages for c in page.chars if c["text"].strip())
        if not sizes:
            return []
        body_size = sizes.most_common(1)[0][0]
        def signature(text):
            return re.sub(r"\b\d+\b", "#", clean(text))
        margins = Counter(signature(line["text"]) for page, lines in pages for line in lines if line["top"] > page.height * .9 or line["bottom"] < page.height * .07)
        blocks, pending = [], []
        previous = None
        intro, numbered_started = False, False

        def flush():
            if pending:
                blocks.append({"type": "paragraph", "text": clean(" ".join(pending))})
                pending.clear()

        for page, _ in pages:
            tables = []
            for table in page.find_tables():
                if len(table.columns) > 1:
                    block = table_block(table)
                    if block:
                        tables.append((table, block))
            def outside_tables(obj):
                if obj.get("object_type") != "char":
                    return True
                x, y = (obj["x0"] + obj["x1"]) / 2, (obj["top"] + obj["bottom"]) / 2
                return not any(t.bbox[0] <= x <= t.bbox[2] and t.bbox[1] <= y <= t.bbox[3] for t, _ in tables)
            events = [(line["top"], "line", line) for line in page.filter(outside_tables).extract_text_lines(return_chars=True)]
            events.extend((t.bbox[1], "table", block) for t, block in tables)
            for _, kind, item in sorted(events, key=lambda event: event[0]):
                if kind == "table":
                    flush()
                    blocks.append(item)
                    previous = None
                    continue
                text = clean(item["text"])
                if not text:
                    continue
                at_margin = item["top"] > page.height * .9 or item["bottom"] < page.height * .07
                if at_margin and (margins[signature(text)] > 1 or text.isdigit()):
                    continue
                is_first = not blocks and not pending
                title = heading(item, body_size, intro and not numbered_started)
                # La portada se agrupa en un solo apartado en lugar de repetir tarjetas.
                if is_first:
                    title = ("", text, "")
                if title:
                    flush()
                    number, label, remainder = title
                    blocks.append({"type": "heading", "number": number, "text": label})
                    intro = True
                    numbered_started = numbered_started or bool(number)
                    if remainder:
                        pending.append(remainder)
                else:
                    bullet = bool(re.match(r"^[•▪●]\s*", text))
                    gap = item["top"] - previous["bottom"] if previous is not None else 0
                    schedule = bool(re.match(r"^Ronda\s+\d+\b", text, re.I))
                    if bullet or schedule or (previous is not None and gap > body_size * .65):
                        flush()
                    pending.append(text)
                previous = item
            # Un párrafo puede continuar en la página siguiente; no se inserta un corte artificial.
            previous = None
        flush()
        return blocks
