# 模具 手办采购订单系统 — 设计文档

日期: 2026-03-04

## 概述

工程部采购订单管理系统，管理模具开模订单和手办制作订单。替代现有Excel手工统计，实现自动化汇总，减少人员统计出错。

## 技术架构

- **后端**: Node.js + Express
- **前端**: HTML + CSS + vanilla JS
- **存储**: JSON文件 (`data/data.json`)
- **图表**: Chart.js (CDN)
- **Excel导出**: SheetJS/xlsx (CDN)

与 production-system 保持一致的技术栈。

## 数据模型

### 模具订单 (mold_orders)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | UUID |
| group | string | 兴信A / 兴信B / 华登 |
| customer | string | 客户名称 |
| product_name | string | 产品名称/编号 |
| mold_qty | number | 模具数量（套） |
| mold_fee | number | 模费（RMB） |
| mold_factory | string | 模厂名称 |
| order_date | string | 下单时间 |
| mold_start_date | string | 开模时间 |
| delivery_date | string | 生产交模时间 |
| status | string | 已下单/已开模/已交模/已完成 |
| payment_type | string | 客付/自付/现金 |
| notes | string | 备注 |
| created_by | string | 创建人 |
| created_at | string | 创建时间 |

### 手办订单 (figure_orders)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | UUID |
| group | string | 兴信A / 兴信B / 华登 |
| customer | string | 客户名称 |
| product_name | string | 产品名称/编号 |
| quantity | number | 数量 |
| figure_fee | number | 手办费（RMB） |
| figure_factory | string | 手办厂名称 |
| order_date | string | 下采购单时间 |
| status | string | 已下单/制作中/已完成 |
| payment_type | string | 客付/自付/现金 |
| notes | string | 备注 |
| created_by | string | 创建人 |
| created_at | string | 创建时间 |

### 基础数据

- **mold_factories**: 力众, 中尚, 昌隆, 亿隆泰, 锐正, 范仕达, 龙之联, 亚细亚
- **figure_factories**: 力图, 海洋, 广祥, 伟盟
- **customers**: 自由输入，系统自动记录
- **eng_users**: [{name, pin}] 工程部用户

### JSON存储结构

```json
{
  "mold_orders": [],
  "figure_orders": [],
  "mold_factories": ["力众", "中尚", "昌隆", "亿隆泰", "锐正", "范仕达", "龙之联", "亚细亚"],
  "figure_factories": ["力图", "海洋", "广祥", "伟盟"],
  "eng_users": [],
  "customers": []
}
```

## 页面结构

### 登录页 (index.html)
- 姓名 + PIN码登录
- 登录信息存 sessionStorage

### 模具订单页 (mold.html)
- 顶部导航：模具订单 | 手办订单 | 用户/退出
- **Tab1: 订单列表**
  - 筛选栏：分组（兴信A/B/华登）、模厂、客户、状态、日期范围
  - 订单表格：所有字段 + 编辑/删除操作
  - 新建按钮 → 弹窗表单
  - 状态流转操作
- **Tab2: 统计报表**
  - 筛选：年份、月份、分组
  - 维度切换：按厂分 / 按客分
  - 汇总表格 + Chart.js 图表（柱状图、饼图）
  - 导出Excel按钮

### 手办订单页 (figure.html)
- 同模具订单页结构
- Tab1: 订单列表（CRUD + 筛选 + 状态）
- Tab2: 统计报表（按厂分/按客分 + 图表 + 导出）

## API接口

### 认证
- `POST /api/login` — 登录

### 模具订单
- `GET /api/mold-orders` — 查询（筛选：group, factory, customer, status, year, month）
- `POST /api/mold-orders` — 新建
- `PUT /api/mold-orders/:id` — 编辑
- `DELETE /api/mold-orders/:id` — 删除
- `PUT /api/mold-orders/:id/status` — 更新状态
- `GET /api/mold-orders/stats` — 统计（参数：year, month, group_by=factory|customer）

### 手办订单
- `GET /api/figure-orders` — 查询
- `POST /api/figure-orders` — 新建
- `PUT /api/figure-orders/:id` — 编辑
- `DELETE /api/figure-orders/:id` — 删除
- `PUT /api/figure-orders/:id/status` — 更新状态
- `GET /api/figure-orders/stats` — 统计

### 基础数据
- `GET /api/factories` — 获取模厂/手办厂列表
- `GET /api/customers` — 获取客户列表

所有写操作需要 `X-User` header。

## 状态流转

**模具订单**: 已下单 → 已开模 → 已交模 → 已完成

**手办订单**: 已下单 → 制作中 → 已完成

## 统计维度

1. **按厂分**: 每个工厂的订单数、总金额、占比
2. **按客分**: 每个客户的订单数、总金额
3. **按月统计**: 每月费用汇总、趋势图
4. **按年汇总**: 年度对比（套数 + 金额）
5. **分组筛选**: 兴信A / 兴信B / 华登 作为全局筛选条件

## 文件结构

```
模具 手办采购订单系统/
├── server.js
├── package.json
├── data/
│   └── data.json
├── public/
│   ├── index.html      # 登录页
│   ├── mold.html       # 模具订单页（含统计）
│   └── figure.html     # 手办订单页（含统计）
└── docs/
    └── plans/
```
