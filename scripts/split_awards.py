"""
Split a large SBIR award CSV into smaller files by Award Year.
Usage: python split_awards.py award_data.csv
Output: award_data_2000.csv, award_data_2001.csv, etc.
"""
import csv
import sys
import os

def split_by_year(input_path: str):
    base = os.path.splitext(input_path)[0]
    writers = {}
    files = {}

    with open(input_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames
        if not headers:
            print("No headers found")
            return

        year_col = None
        for col in ['Award Year', 'award_year', 'Award year']:
            if col in headers:
                year_col = col
                break
        if not year_col:
            print(f"No year column found. Headers: {headers[:10]}")
            return

        for row in reader:
            year = (row.get(year_col) or 'unknown').strip()[:4]
            if year not in writers:
                path = f"{base}_{year}.csv"
                fh = open(path, 'w', newline='', encoding='utf-8')
                files[year] = fh
                writers[year] = csv.DictWriter(fh, fieldnames=headers)
                writers[year].writeheader()
            writers[year].writerow(row)

    for year, fh in sorted(files.items()):
        fh.close()
        size = os.path.getsize(f"{base}_{year}.csv")
        print(f"  {base}_{year}.csv — {size / 1024 / 1024:.1f} MB")

    print(f"\nSplit into {len(files)} files by year")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python split_awards.py award_data.csv")
    else:
        split_by_year(sys.argv[1])
