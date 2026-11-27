"""Export the 9 data sheets of Attendee_Dataset.xlsx to data/json/<table>.json (rows as-is, no cleaning).
Supabase loads these with http_get + json_populate_recordset (see supabase/sql/03_load_from_github.sql).
Usage: python3 scripts/make_json.py data/Attendee_Dataset.xlsx data/json
"""
import sys, json, pandas as pd
sys.path.insert(0, __import__('os').path.dirname(__file__))
from make_seed import SHEETS

def main(xlsx, outdir):
    x = pd.read_excel(xlsx, sheet_name=None)
    for sheet, (tab, cols) in SHEETS.items():
        d = x[sheet][cols].copy()
        for c in d.columns:
            if str(d[c].dtype).startswith('datetime'):
                d[c] = d[c].dt.strftime('%Y-%m-%d %H:%M:%S')
        recs = json.loads(d.to_json(orient='records'))
        json.dump(recs, open(f'{outdir}/{tab}.json', 'w'), separators=(',', ':'))
        print(tab, len(recs))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
