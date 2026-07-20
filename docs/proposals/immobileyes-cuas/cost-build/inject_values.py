#!/usr/bin/env python3
"""Inject cached <v> values into formula cells (LibreOffice is unavailable in this sandbox).
Formulas are kept; Excel/Sheets/LibreOffice recompute on open. Also verifies arithmetic."""
import zipfile, shutil, re, os

XLSX = "docs/proposals/immobileyes-cuas/Immobileyes_DON26BX03-NP002_Cost_Volume.xlsx"

def period_vals(labor, materials, travel, ceiling):
    n = len(labor)
    first = 12; last = 11 + n
    R = dict(tdl=12+n, fringe=15+n, oh=16+n, burd=17+n, mat=18+n, trav=19+n,
             gab=20+n, ga=21+n, tc=22+n, fee=23+n, tot=24+n, ceil=26+n, margin=27+n)
    v = {}
    tdl = 0.0; hrs_sum = 0
    for i,(rate,hrs) in enumerate(labor):
        v[f"E{12+i}"] = rate*hrs; tdl += rate*hrs; hrs_sum += hrs
    v[f"D{R['tdl']}"] = hrs_sum
    v[f"E{R['tdl']}"] = tdl
    fringe = tdl*0.35;      v[f"E{R['fringe']}"] = fringe
    oh = (tdl+fringe)*0.77; v[f"E{R['oh']}"] = oh
    burd = tdl+fringe+oh;   v[f"E{R['burd']}"] = burd
    gab = burd+materials+travel; v[f"E{R['gab']}"] = gab
    ga = gab*0.40;          v[f"E{R['ga']}"] = ga
    tc = gab+ga;            v[f"E{R['tc']}"] = tc
    fee = tc*0.07;          v[f"E{R['fee']}"] = fee
    tot = tc+fee;           v[f"E{R['tot']}"] = tot
    v[f"E{R['margin']}"] = ceiling - tot
    return v, tot

base_labor = [(63,250),(50,320),(45,200),(45,140),(50,90)]
opt_labor  = [(63,110),(50,200),(45,110),(35,90),(30,60),(45,40)]
base_v, base_tot = period_vals(base_labor, 7000, 3000, 200000)
opt_v,  opt_tot  = period_vals(opt_labor,  6000, 2000, 115000)
summary_v = {"B5": base_tot, "B6": opt_tot, "B7": base_tot+opt_tot}

print(f"VERIFY  Base=${base_tot:,.2f} (<=200000: {base_tot<=200000})  "
      f"Option=${opt_tot:,.2f} (<=115000: {opt_tot<=115000})  Phase I=${base_tot+opt_tot:,.2f}")

# Map sheet display-name -> worksheet xml path via workbook.xml + rels
tmp = XLSX + ".tmp"
shutil.copy(XLSX, tmp)
zin = zipfile.ZipFile(tmp)
wbxml = zin.read("xl/workbook.xml").decode()
rels = zin.read("xl/_rels/workbook.xml.rels").decode()
def attr(el, name):
    m = re.search(r'\b%s="([^"]+)"' % re.escape(name), el)
    return m.group(1) if m else None
name_to_rid = {}
for el in re.findall(r'<sheet\b[^>]*/?>', wbxml):
    nm = attr(el, 'name'); rid = attr(el, 'r:id') or attr(el, 'id')
    if nm and rid: name_to_rid[nm] = rid
rid_to_target = {}
for el in re.findall(r'<Relationship\b[^>]*/?>', rels):
    rid = attr(el, 'Id'); tgt = attr(el, 'Target')
    if rid and tgt: rid_to_target[rid] = tgt
def sheet_path(name):
    t = rid_to_target[name_to_rid[name]].lstrip("/")
    return t if t.startswith("xl/") else "xl/" + t

targets = {"Base": base_v, "Option": opt_v, "Summary": summary_v}

def inject(xml, vals):
    for ref, val in vals.items():
        num = repr(round(float(val), 6))
        # <c r="E29" ...><f ...>FORMULA</f></c>  ->  ...<f>...</f><v>num</v></c>
        pat = re.compile(r'(<c r="%s"[^>]*>)(<f[^>]*>[^<]*</f>)(</c>)' % re.escape(ref))
        new, k = pat.subn(lambda m: m.group(1)+m.group(2)+f"<v>{num}</v>"+m.group(3), xml)
        if k == 0:
            # cell may already contain a <v> or a shared-formula shape; try replacing existing <v>
            pat2 = re.compile(r'(<c r="%s"[^>]*>(?:<f[^>]*>[^<]*</f>))(?:<v>[^<]*</v>)?(</c>)' % re.escape(ref))
            new, k = pat2.subn(lambda m: m.group(1)+f"<v>{num}</v>"+m.group(2), xml)
        xml = new
    return xml

patched = {}
for name, vals in targets.items():
    p = sheet_path(name)
    patched[p] = inject(zin.read(p).decode(), vals)
names = zin.namelist()
original = {nm: zin.read(nm) for nm in names}
zin.close()

# set fullCalcOnLoad so consumers recompute regardless
wbxml2 = wbxml
if "calcPr" in wbxml2:
    wbxml2 = re.sub(r'<calcPr[^>]*/>', '<calcPr calcId="0" fullCalcOnLoad="1"/>', wbxml2)
else:
    wbxml2 = wbxml2.replace("</workbook>", '<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>')

with zipfile.ZipFile(XLSX, "w", zipfile.ZIP_DEFLATED) as z:
    for nm in names:
        if nm in patched: z.writestr(nm, patched[nm])
        elif nm == "xl/workbook.xml": z.writestr(nm, wbxml2)
        else: z.writestr(nm, original[nm])
os.remove(tmp)
print("injected cached values into", XLSX)
