#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""echo/js/levels.js を生成する。
   全マップの寸法・接続性（P -> 遺物 -> E）を検証してから書き出す。"""

import json
from collections import deque

WALL, FLOOR, WATER = '#', '.', '~'


class Grid:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.g = [[FLOOR] * w for _ in range(h)]
        self.border()

    def border(self):
        for x in range(self.w):
            self.g[0][x] = WALL
            self.g[self.h - 1][x] = WALL
        for y in range(self.h):
            self.g[y][0] = WALL
            self.g[y][self.w - 1] = WALL

    def rect(self, x, y, w, h, c=WALL):
        for j in range(y, min(y + h, self.h)):
            for i in range(x, min(x + w, self.w)):
                if 0 <= i < self.w and 0 <= j < self.h:
                    self.g[j][i] = c

    def fill_all(self, c):
        for y in range(1, self.h - 1):
            for x in range(1, self.w - 1):
                self.g[y][x] = c

    def get(self, x, y):
        return self.g[y][x]

    def put(self, x, y, c):
        self.g[y][x] = c

    def walkable(self, x, y):
        return self.g[y][x] in (FLOOR, WATER)

    def rows(self):
        return [''.join(r) for r in self.g]


# ---------- 迷路生成（決定的な線形合同法PRNG） ----------
class Rng:
    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def next(self):
        self.s = (self.s * 1103515245 + 12345) & 0x7FFFFFFF
        return self.s

    def rand(self, n):
        return self.next() % n

    def shuffle(self, a):
        for i in range(len(a) - 1, 0, -1):
            j = self.rand(i + 1)
            a[i], a[j] = a[j], a[i]
        return a


def carve_maze(g, x0, y0, w, h, seed, braid=0.45):
    """(x0,y0) から w x h の領域に、壁1マス幅の迷路を掘る。w,h は奇数推奨。"""
    rng = Rng(seed)
    g.rect(x0, y0, w, h, WALL)
    cw, ch = (w - 1) // 2, (h - 1) // 2
    visited = [[False] * cw for _ in range(ch)]
    stack = [(0, 0)]
    visited[0][0] = True
    g.put(x0 + 1, y0 + 1, FLOOR)
    while stack:
        cx, cy = stack[-1]
        nb = []
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < cw and 0 <= ny < ch and not visited[ny][nx]:
                nb.append((nx, ny, dx, dy))
        if not nb:
            stack.pop()
            continue
        nx, ny, dx, dy = rng.shuffle(nb)[0]
        visited[ny][nx] = True
        g.put(x0 + 1 + cx * 2 + dx, y0 + 1 + cy * 2 + dy, FLOOR)
        g.put(x0 + 1 + nx * 2, y0 + 1 + ny * 2, FLOOR)
        stack.append((nx, ny))
    # 行き止まりを一部つないでループを作る（一本道すぎると理不尽なので）
    for cy in range(ch):
        for cx in range(cw):
            if rng.rand(100) < braid * 100:
                x, y = x0 + 1 + cx * 2, y0 + 1 + cy * 2
                dirs = rng.shuffle([(1, 0), (-1, 0), (0, 1), (0, -1)])
                for dx, dy in dirs:
                    wx, wy = x + dx, y + dy
                    tx, ty = x + dx * 2, y + dy * 2
                    if (x0 < tx < x0 + w - 1 and y0 < ty < y0 + h - 1
                            and g.get(tx, ty) == FLOOR and g.get(wx, wy) == WALL):
                        g.put(wx, wy, FLOOR)
                        break


def nearest_floor(g, x, y):
    if g.walkable(x, y):
        return x, y
    seen = {(x, y)}
    q = deque([(x, y)])
    while q:
        cx, cy = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < g.w and 0 <= ny < g.h and (nx, ny) not in seen:
                seen.add((nx, ny))
                if g.walkable(nx, ny):
                    return nx, ny
                q.append((nx, ny))
    raise RuntimeError('床が見つからない')


def reachable(g, sx, sy):
    seen = {(sx, sy)}
    q = deque([(sx, sy)])
    while q:
        cx, cy = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < g.w and 0 <= ny < g.h and (nx, ny) not in seen and g.walkable(nx, ny):
                seen.add((nx, ny))
                q.append((nx, ny))
    return seen


# =========================================================
#  ステージ定義
# =========================================================
levels = []


def build(name, desc, hint, g, ents):
    """ents: {'P':(x,y), 'E':(x,y), 'relics':[...], 'M':[...], 'S':[...]}"""
    px, py = nearest_floor(g, *ents['P'])
    ex, ey = nearest_floor(g, *ents['E'])
    reach = reachable(g, px, py)
    assert (ex, ey) in reach, '%s: 出口に到達できない' % name

    placed = []
    for kind, key in (('*', 'relics'), ('M', 'M'), ('S', 'S')):
        for (x, y) in ents.get(key, []):
            nx, ny = nearest_floor(g, x, y)
            assert (nx, ny) in reach, '%s: %s(%d,%d) に到達できない' % (name, kind, nx, ny)
            placed.append((kind, nx, ny))

    g.put(px, py, 'P')
    g.put(ex, ey, 'E')
    for kind, x, y in placed:
        if g.get(x, y) in ('P', 'E'):
            raise RuntimeError('%s: 配置が重なった (%d,%d)' % (name, x, y))
        g.put(x, y, kind)

    rows = g.rows()
    ws = set(len(r) for r in rows)
    assert len(ws) == 1, '%s: 行の長さが不揃い %s' % (name, ws)
    levels.append({'name': name, 'desc': desc, 'hint': hint, 'map': rows})


# ---------------- 1: 導きの回廊 ----------------
g = Grid(32, 20)
g.rect(5, 3, 9, 4)
g.rect(19, 3, 8, 3)
g.rect(5, 10, 4, 7)
g.rect(12, 9, 10, 3)
g.rect(25, 9, 4, 8)
g.rect(12, 14, 8, 3)
g.rect(16, 6, 3, 2)
build('導きの回廊', '足音だけを頼りに', 'ドラッグして歩く。壁に跳ね返る波が地形を教えてくれる。',
      g, {'P': (2, 2), 'E': (29, 18)})

# ---------------- 2: 水の間 ----------------
g = Grid(34, 22)
g.rect(4, 4, 10, 3)
g.rect(18, 2, 3, 9)
g.rect(24, 5, 7, 3)
g.rect(4, 10, 9, 3)
g.rect(16, 13, 12, 3)
g.rect(6, 16, 4, 4)
g.rect(24, 16, 6, 3)
g.rect(13, 17, 6, 2)
# 水たまり
g.rect(2, 7, 5, 2, WATER)
g.rect(14, 6, 3, 5, WATER)
g.rect(21, 10, 6, 2, WATER)
g.rect(8, 14, 4, 2, WATER)
g.rect(29, 12, 3, 4, WATER)
build('水の間', '静かに、ゆっくりと', '水は大きな音を立てる。眠っているものを起こさぬように。',
      g, {'P': (2, 2), 'E': (31, 20), 'relics': [(30, 3)], 'S': [(20, 8)]})

# ---------------- 3: 巣 ----------------
g = Grid(36, 24)
for i, (x, y, w, h) in enumerate([
        (3, 3, 6, 3), (12, 2, 3, 7), (19, 4, 8, 3), (30, 3, 3, 6),
        (3, 8, 6, 3), (17, 10, 4, 6), (24, 9, 3, 8), (30, 12, 3, 5),
        (3, 14, 8, 3), (12, 12, 3, 6), (6, 19, 9, 3), (19, 19, 8, 3),
        (28, 19, 5, 2)]):
    g.rect(x, y, w, h)
g.rect(2, 12, 2, 1, WATER)
g.rect(15, 8, 2, 2, WATER)
build('巣', '二つの気配', '赤い波は、こちらの音を聞いている。走れば必ず気づかれる。',
      g, {'P': (2, 2), 'E': (33, 22), 'relics': [(34, 10), (2, 21)],
          'M': [(21, 3)], 'S': [(9, 17)]})

# ---------------- 4: 迷路 ----------------
g = Grid(37, 27)
carve_maze(g, 0, 0, 37, 27, seed=20240817, braid=0.5)
# 入口と出口まわりに小部屋を開ける
g.rect(1, 1, 4, 3, FLOOR)
g.rect(32, 23, 4, 3, FLOOR)
g.rect(16, 12, 5, 3, FLOOR)
build('迷路', '出口は遠い', '手を叩けば遠くまで見える。ただし、あちらにも聞こえる。',
      g, {'P': (2, 2), 'E': (34, 24), 'relics': [(18, 13)],
          'M': [(18, 3), (5, 22)], 'S': [(30, 8)]})

# ---------------- 5: 深淵 ----------------
g = Grid(40, 28)
for (x, y, w, h) in [
        (4, 3, 7, 3), (14, 2, 3, 8), (20, 3, 9, 3), (32, 2, 4, 7),
        (4, 8, 6, 4), (19, 9, 3, 8), (25, 8, 3, 6), (31, 11, 6, 3),
        (3, 15, 9, 3), (14, 13, 3, 8), (25, 16, 3, 7), (33, 17, 4, 4),
        (6, 20, 6, 4), (18, 22, 9, 3), (30, 24, 6, 2),
        (9, 5, 2, 2), (22, 19, 2, 2)]:
    g.rect(x, y, w, h)
g.rect(2, 12, 6, 2, WATER)
g.rect(17, 5, 2, 4, WATER)
g.rect(28, 14, 4, 2, WATER)
g.rect(12, 24, 5, 2, WATER)
g.rect(36, 8, 3, 3, WATER)
build('深淵', 'すべてが此処にいる', '音を立てずに動くほど、生き延びられる。',
      g, {'P': (2, 2), 'E': (37, 26),
          'relics': [(38, 4), (2, 26), (21, 12)],
          'M': [(23, 5), (8, 18), (30, 20)], 'S': [(16, 11)]})


# =========================================================
#  書き出し
# =========================================================
out = ['/* ============================================================',
       '   残響 — ステージデータ',
       '   # 壁 / . 床 / ~ 水（大きな音が出る）',
       '   P 開始地点 / E 出口 / * 遺物 / M 徘徊する化け物 / S 眠っている化け物',
       '   ※ このファイルは tools/genlevels.py で生成しています',
       '   ============================================================ */',
       '',
       'var LEVELS = [']

for i, L in enumerate(levels):
    out.append('  {')
    out.append('    name: %s,' % json.dumps(L['name'], ensure_ascii=False))
    out.append('    desc: %s,' % json.dumps(L['desc'], ensure_ascii=False))
    out.append('    hint: %s,' % json.dumps(L['hint'], ensure_ascii=False))
    out.append('    map: [')
    for r in L['map']:
        out.append('      "%s",' % r)
    out.append('    ]')
    out.append('  }%s' % ('' if i == len(levels) - 1 else ','))

out.append('];')
out.append('')

with open('/home/user/keelpop.github.io/echo/js/levels.js', 'w') as f:
    f.write('\n'.join(out))

for L in levels:
    w, h = len(L['map'][0]), len(L['map'])
    floors = sum(r.count('.') + r.count('~') for r in L['map'])
    print('OK  %-8s %2dx%-2d  歩ける床 %4d  遺物 %d  M %d  S %d'
          % (L['name'], w, h, floors,
             sum(r.count('*') for r in L['map']),
             sum(r.count('M') for r in L['map']),
             sum(r.count('S') for r in L['map'])))
print('\n--- ステージ4 プレビュー ---')
for r in levels[3]['map']:
    print(r)
