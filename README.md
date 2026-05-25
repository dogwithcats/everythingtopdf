# Image to PDF Chrome Extension (MV3)

基于 **React + TypeScript + Vite** 开发的 Manifest V3 Chrome 插件，提供本地图片转 PDF 能力。

## 功能特性

- 支持上传多张 JPG / PNG / WEBP 图片
- 支持拖拽排序、删除单张、清空列表
- 显示图片缩略图、文件名、文件大小、分辨率
- 支持两种 PDF 输出模式：
  - **A4 自适应**
  - **原图尺寸**（每页保持对应图片像素尺寸）
- 生成 PDF 时使用 `NONE` 压缩策略，避免二次压缩导致画质下降
- 所有处理在浏览器本地完成，不请求任何外部接口
- 点击“生成 PDF”自动下载
- 简洁现代 UI，适合工具类产品

## 本地运行

```bash
npm install
npm run build
```

构建后会生成 `dist/`。

## 在 Chrome 中加载插件

1. 打开 Chrome，进入 `chrome://extensions/`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目中的 `dist/` 目录
5. 点击插件图标即可打开工具

## 开发模式

```bash
npm install
npm run dev
```

> 开发时可先运行 `npm run build`，再加载 `dist/` 验证 MV3 插件行为。

## 技术说明

- PDF 生成使用 `jsPDF`
- 拖拽排序使用 `@dnd-kit`
- 使用 Vite 构建，`public/manifest.json` 会原样输出到 `dist/manifest.json`

## 说明

- 为避免某些代码托管/PR 工具对二进制文件的限制，当前版本不包含二进制图标文件。
- 如需图标，可后续在本地自行补充 `public/icon16.png`、`public/icon48.png`、`public/icon128.png` 并在 `manifest.json` 增加 `icons` 字段。


## Chrome 应用商店图标说明

- 已提供符合商店安全区规范的 128 模板：`public/logo-store-128-template.svg`。
- 该模板按 **128x128 画布 + 中心 96x96 主体 + 四周 16px 透明边距** 设计。
- 上传商店前请导出为 PNG：`icon128.png`（必须 PNG）。
- 建议再从同一母版导出 `icon48.png`、`icon16.png`，并在 `manifest.json` 中配置 `icons` 与 `action.default_icon`。
