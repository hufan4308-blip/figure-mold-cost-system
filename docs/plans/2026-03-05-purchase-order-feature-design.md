# 采购下单功能 - 设计文档

日期: 2026-03-05

## 概述

在现有模具/手办订单管理系统基础上，增加"采购单"功能。将多条同客户+同工厂的订单明细打包成一张正式采购单，支持打印和导出 Excel。采购单格式参照现有 BS069 Excel 模版。

## 数据模型

### 采购单 (purchase_orders)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | number | 自增ID |
| po_number | string | 采购单编号（如 Bb20241109） |
| type | string | mold / figure |
| group | string | 兴信A / 兴信B / 华登 |
| supplier_name | string | 供应商名称（模厂/手办厂） |
| supplier_contact | string | 供应商联络人 |
| supplier_phone | string | 供应商电话 |
| supplier_fax | string | 供应商传真 |
| our_contact | string | 我方联络人 |
| our_phone | string | 我方电话 |
| product_name | string | 产品名称（如 BS069） |
| items | array | 明细行（见下方） |
| delivery_date_text | string | 交货条件文本 |
| delivery_address | string | 交货地址 |
| payment_terms | string | 付款方式文本 |
| payment_type | string | 客付 / 自付 |
| tax_rate | number | 增值税率（默认13） |
| settlement_days | number | 月结天数（默认30） |
| notes | string | 其他备注 |
| status | string | 草稿 / 已确认 |
| created_by | string | 创建人 |
| created_at | string | 创建时间 |

### 模具采购单明细 item (type=mold)

| 字段 | 类型 | 说明 |
|------|------|------|
| seq | number | 序号 |
| part_name | string | 零件名称 |
| material | string | 材料 |
| gate | string | GATE |
| cav_up | string | CAV/UP |
| unit_price | number | 单价 |
| amount | number | 金额(RMB) |
| image | string | 图片路径 |
| notes | string | 备注 |

### 手办采购单明细 item (type=figure)

| 字段 | 类型 | 说明 |
|------|------|------|
| seq | number | 序号 |
| product_name | string | 产品名称 |
| quantity | number | 数量 |
| unit_price | number | 单价 |
| amount | number | 金额 |
| notes | string | 备注 |

## JSON 存储

在 data.json 中新增：
```json
{
  "purchase_orders": [],
  "po_next_id": 1
}
```

## 页面变更

### 1. mold.html / figure.html - 新增 Tab

新增第三个 Tab："采购单"
- 采购单列表：编号、供应商、产品名称、金额合计、状态、日期、操作
- "新建采购单"按钮 -> 弹窗表单
- 操作：查看/打印、编辑、删除

### 2. 新建采购单弹窗

分两部分：
- **表头信息**：采购单编号（自动生成，可改）、分组、供应商（从工厂列表选）、联络人、电话、产品名称、付款方式、费用承担（客付/自付）
- **明细表格**：可动态增删行
  - 模具：零件名称/材料/GATE/CAV·UP/单价/金额/图片/备注
  - 手办：产品名称/数量/单价/金额/备注
- 自动计算合计金额

### 3. po-print.html - 采购单打印页

独立页面，通过 URL 参数 `?id=xxx` 加载采购单数据，完全按照 BS069 模版格式排版：

```
东莞兴信塑胶制品有限公司
地址 / TEL / FAX
          采购单

供应商：xxx          订单编号：xxx
联络人：xxx          联络人：xxx
联系电话：xxx        联系电话：xxx

产品名称：xxx

| 序号 | 零件名称 | 材料 | GATE | CAV/UP | 单价 | 金额(RMB) | 图片 | 备注 |
|------|---------|------|------|--------|------|-----------|------|------|
| 1    | ...     | ...  | ...  | ...    | ...  | ...       |      |      |
|      |         |      |      | 合计：  |      | xxx       |      |      |

1. yyyy年mm月dd日前交货...
2. 单价已含 13% 增值税，月结 30 天
3. 货物及部件质量符合国外现行最新标准

注意事项：（固定条款）

费用承担：客人付款[ ] 兴信自付[ ]

供应商确认：    采购签核：    主管：    经理：
```

- 打印按钮：`window.print()`
- 导出 Excel 按钮：用 SheetJS 生成与打印格式一致的 Excel

## API 新增

### 采购单
- `GET /api/purchase-orders` - 列表（筛选：type, group, year, status）
- `GET /api/purchase-orders/:id` - 详情
- `POST /api/purchase-orders` - 创建
- `PUT /api/purchase-orders/:id` - 编辑
- `DELETE /api/purchase-orders/:id` - 删除
- `PUT /api/purchase-orders/:id/status` - 状态变更（草稿 -> 已确认）

## 采购单编号规则

格式：`{前缀}{日期}{序号}`
- 前缀：B（模具）/ F（手办）
- 日期：yyyyMMdd
- 示例：B20260305、F20260305

用户可在创建时自定义编号。

## 实施范围

修改文件：
- server.js - 新增采购单 API
- data/data.json - 新增 purchase_orders 字段
- mold.html - 新增采购单 Tab + 创建弹窗
- figure.html - 新增采购单 Tab + 创建弹窗

新增文件：
- public/po-print.html - 采购单打印预览页
