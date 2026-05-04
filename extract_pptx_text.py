#!/usr/bin/env python3
import zipfile
import re
import sys

pptx_path = r"C:\Users\lefeb\AppData\Roaming\Claude\local-agent-mode-sessions\3e05fc18-c8ad-44f2-97b5-5c3c874b8090\2c9be5a2-a75a-4e3d-b656-94f5777d5726\local_8c6f1f1c-fb26-49bc-83bf-05ac23081dd6\uploads\bugs et features.pptx"

try:
    with zipfile.ZipFile(pptx_path, 'r') as zip_ref:
        slide_files = [f for f in zip_ref.namelist() if f.startswith('ppt/slides/slide') and f.endswith('.xml')]
        slide_files.sort(key=lambda x: int(''.join(filter(str.isdigit, x.split('/')[-1]))))

        for idx, slide_file in enumerate(slide_files, 1):
            print(f"## Slide {idx}")
            xml_content = zip_ref.read(slide_file).decode('utf-8')
            texts = re.findall(r'<a:t>([^<]*)</a:t>', xml_content)
            for text in texts:
                if text.strip():
                    print(text)
            print()
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
