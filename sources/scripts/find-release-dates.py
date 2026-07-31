"""用 ALFRED 的 vintage 反查各指標的實際發布日（校準 timeline.ts 的 RELEASE_RULE）。

用法：python3 scripts/find-release-dates.py
發布規律若日後改變（或要新增指標），跑這支重新歸納區間再回填 RELEASE_RULE。

vintage 是單調的（某一期一旦發布就不會消失），故可二分搜尋
「該期別首次出現在哪個 vintage」—— 那一天就是實際發布日。
"""
import urllib.request, datetime, sys, re

UA = 'stock-pnl-web (+https://github.com/CTJ425/stock-pnl-web)'


def has_period(sid: str, period: str, vintage: datetime.date) -> bool:
    """該 vintage 是否已含 period（YYYY-MM）"""
    cosd = f'{period}-01'
    url = (f'https://alfred.stlouisfed.org/graph/alfredgraph.csv'
           f'?id={sid}&cosd={cosd}&vintage_date={vintage.isoformat()}')
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/csv'})
    try:
        body = urllib.request.urlopen(req, timeout=20).read().decode('utf-8', 'replace')
    except Exception:
        return False
    for line in body.splitlines()[1:]:
        m = re.match(r'^(\d{4})-(\d{2})-\d{2},\s*(.+)$', line.strip())
        if m and f'{m.group(1)}-{m.group(2)}' == period and m.group(3).strip():
            return True
    return False


def release_date(sid: str, period: str):
    """period 這一期的實際發布日（在次月內二分搜尋）"""
    y, m = map(int, period.split('-'))
    nm = datetime.date(y + (m == 12), (m % 12) + 1, 1)
    lo, hi = nm, (nm.replace(day=28) + datetime.timedelta(days=10)).replace(day=1) - datetime.timedelta(days=1)
    if not has_period(sid, period, hi):
        return None  # 次月底都還沒發，規律不適用
    while lo < hi:
        mid = lo + (hi - lo) // 2
        if has_period(sid, period, mid):
            hi = mid
        else:
            lo = mid + datetime.timedelta(days=1)
    return lo


SERIES = [
    ('CPILFESL', '核心 CPI', ['2026-04', '2026-05', '2026-06']),
    ('PPIFES', '核心 PPI', ['2026-04', '2026-05', '2026-06']),
    ('PCEPILFE', '核心 PCE', ['2026-04', '2026-05', '2026-06']),
    ('PAYEMS', '非農就業', ['2026-04', '2026-05', '2026-06']),
    ('UMCSENT', '消費者信心', ['2026-03', '2026-04', '2026-05']),
]

WD = '一二三四五六日'
print(f"{'指標':<12} {'期別':<9} {'實際發布日':<12} 星期  當月第幾天")
print('─' * 56)
summary = {}
for sid, label, periods in SERIES:
    days = []
    for p in periods:
        d = release_date(sid, p)
        if d:
            days.append(d.day)
            print(f'{label:<12} {p:<9} {d.isoformat():<12} 週{WD[d.weekday()]}   {d.day:>2} 日')
        else:
            print(f'{label:<12} {p:<9} {"(次月內未發布)":<12}')
    summary[label] = days
print()
for label, days in summary.items():
    if days:
        print(f'{label}: 發布日落在 {min(days)}–{max(days)} 日')
