#!/bin/bash
cd "C:\Dev\GEOPERF"
python3 extract_and_output.py > extract_result.txt 2>&1
cat extract_result.txt
