import zipfile, re, sys
p = r"C:\Users\lefeb\AppData\Roaming\Claude\local-agent-mode-sessions\3e05fc18-c8ad-44f2-97b5-5c3c874b8090\2c9be5a2-a75a-4e3d-b656-94f5777d5726\local_8c6f1f1c-fb26-49bc-83bf-05ac23081dd6\uploads\bugs et features.pptx"
o = r"C:\Dev\GEOPERF\saas\docs\_bugs_ppt_extract.txt"
z = zipfile.ZipFile(p)
s = sorted([f for f in z.namelist() if 'ppt/slides/slide' in f and f.endswith('.xml')], key=lambda x: int(''.join([c for c in x if c.isdigit()])))
r = []
for i, f in enumerate(s, 1):
    r.append(f"## Slide {i}")
    x = z.read(f).decode()
    t = re.findall(r'<a:t>([^<]*)</a:t>', x)
    r.extend([x.strip() for x in t if x.strip()])
    r.append("")
z.close()
c = '\n'.join(r)
print(c)
with open(o, 'w', encoding='utf-8') as f: f.write(c)
print(f"\n[Saved to {o}]")
