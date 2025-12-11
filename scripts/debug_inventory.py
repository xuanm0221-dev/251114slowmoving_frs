# -*- coding: utf-8 -*-
"""디버그용 스크립트"""

import pandas as pd

VALID_BRANDS = {"MLB", "MLB KIDS", "DISCOVERY"}
TARGET_CATEGORY = "饰品"
CORE_SEASONS = ["24FW", "25SS", "25FW", "26SS"]


def determine_operation_group(op_basis, season):
    op_basis = str(op_basis).strip() if pd.notna(op_basis) else ""
    season = str(season).strip() if pd.notna(season) else ""
    
    if op_basis in ["INTRO", "FOCUS", "26SS"]:
        return "core"
    
    if op_basis == "":
        for core_season in CORE_SEASONS:
            if core_season in season:
                return "core"
    
    return "outlet"


df = pd.read_csv(r"D:\data\inventory\2025.11.csv", encoding="utf-8-sig", nrows=100000)

# 컬럼 인덱스 확인
brand_col = df.columns[18]  # 产品品牌
category_col = df.columns[27]  # 产品大分类
op_col = df.columns[32]  # 运营基准
season_col = df.columns[19]  # 产品季节
amount_col = df.columns[49]  # 预计库存金额

df_filtered = df[df[brand_col].isin(VALID_BRANDS)]
df_filtered = df_filtered[df_filtered[category_col] == TARGET_CATEGORY]

with open("temp_debug.txt", "w", encoding="utf-8") as f:
    f.write(f"Brand column: {brand_col}\n")
    f.write(f"Category column: {category_col}\n")
    f.write(f"Op column: {op_col}\n")
    f.write(f"Season column: {season_col}\n")
    f.write(f"Amount column: {amount_col}\n\n")
    f.write(f"Filtered rows: {len(df_filtered)}\n\n")
    
    f.write("Sample of op_basis and season:\n")
    sample = df_filtered[[brand_col, op_col, season_col, amount_col]].head(50)
    for _, row in sample.iterrows():
        op = row[op_col]
        season = row[season_col]
        result = determine_operation_group(op, season)
        f.write(f"{row[brand_col]} | op={op} | season={season} | -> {result}\n")
    
    # Count by operation group
    df_filtered["op_group"] = df_filtered.apply(
        lambda r: determine_operation_group(r[op_col], r[season_col]), axis=1
    )
    f.write("\n\nCount by operation group:\n")
    f.write(str(df_filtered["op_group"].value_counts()) + "\n")
    
    # Sum by operation group
    f.write("\nSum by operation group:\n")
    f.write(str(df_filtered.groupby("op_group")[amount_col].sum()) + "\n")

print("Done! Check temp_debug.txt")






