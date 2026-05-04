#!/usr/bin/env python3
"""Extract text content from PPTX file using only stdlib."""
import zipfile
import re

def extract_pptx_text(pptx_path):
    """Extract all text from a PPTX file."""
    content = []

    try:
        with zipfile.ZipFile(pptx_path, 'r') as zip_ref:
            # List all slide files
            slide_files = sorted(
                [f for f in zip_ref.namelist() if f.startswith('ppt/slides/slide') and f.endswith('.xml')],
                key=lambda x: int(''.join(filter(str.isdigit, x.split('/')[-1])))
            )

            for idx, slide_file in enumerate(slide_files, 1):
                content.append(f"## Slide {idx}")

                # Read XML content
                xml_data = zip_ref.read(slide_file).decode('utf-8')

                # Extract text from <a:t> tags (OpenXML text format)
                text_matches = re.findall(r'<a:t>([^<]*)</a:t>', xml_data)

                for text in text_matches:
                    stripped = text.strip()
                    if stripped:
                        content.append(stripped)

                content.append("")  # Blank line between slides

        return '\n'.join(content)

    except Exception as e:
        return f"Error extracting PPTX: {e}"

if __name__ == "__main__":
    pptx_input = r"C:\Users\lefeb\AppData\Roaming\Claude\local-agent-mode-sessions\3e05fc18-c8ad-44f2-97b5-5c3c874b8090\2c9be5a2-a75a-4e3d-b656-94f5777d5726\local_8c6f1f1c-fb26-49bc-83bf-05ac23081dd6\uploads\bugs et features.pptx"
    output_file = r"C:\Dev\GEOPERF\saas\docs\_bugs_ppt_extract.txt"

    result = extract_pptx_text(pptx_input)

    # Write to file
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(result)

    # Also print to stdout
    print(result)
    print(f"\n\n[Output saved to {output_file}]")
