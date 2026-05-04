#!/usr/bin/env python3
import zipfile
import os

pptx_path = r"C:\Users\lefeb\AppData\Roaming\Claude\local-agent-mode-sessions\3e05fc18-c8ad-44f2-97b5-5c3c874b8090\2c9be5a2-a75a-4e3d-b656-94f5777d5726\local_8c6f1f1c-fb26-49bc-83bf-05ac23081dd6\uploads\bugs et features.pptx"
extract_dir = r"C:\Dev\GEOPERF\pptx_extracted"

os.makedirs(extract_dir, exist_ok=True)

with zipfile.ZipFile(pptx_path, 'r') as zip_ref:
    zip_ref.extractall(extract_dir)

print(f"Extracted to {extract_dir}")

# List slide files
import glob
slide_files = sorted(glob.glob(os.path.join(extract_dir, "ppt/slides/slide*.xml")),
                    key=lambda x: int(''.join(filter(str.isdigit, os.path.basename(x)))))

print(f"Found {len(slide_files)} slides:")
for f in slide_files:
    print(f"  {f}")
