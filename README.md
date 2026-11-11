# FlareBible — 在线圣经阅读站

FlareBible 是一个纯静态的在线圣经阅读网站：逐章阅读、五种译本、全文搜索、书签、高亮、笔记、一年读经计划。没有后端、没有数据库、没有构建步骤，数据全部在浏览器本地，打开即用。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Nesive/FlareBible)

> 点上面的按钮，Cloudflare 会读取仓库里的 `wrangler.toml` 自动创建一个 Pages 项目并部署。没有数据库、没有密钥、没有构建步骤，部署完成即可访问。如果按钮流程没有正确识别为 Pages 项目，改走下面的命令行部署。

在线演示：[bible.nesive.com](https://bible.nesive.com)

## 功能

- **逐章阅读**：节号、段落标题、诗歌体分行，上一章 / 下一章翻页
- **五种译本**：和合本、KJV、当代译本、吕振中、ESV；另有和合本 + KJV 对照阅读
- **点选经文**：点一下经文即选中（下划线标记），可继续点选其他节；选中后可复制、分享、高亮、加书签、写笔记
- **复制格式可选**：编号分段 / 句末出处 / 纯经文（设置里切换）。句末出处例：这样人们就知道我是耶和华（以西结书 28:20 和合本）
- **逐节对照页**：当前译本 + 和合本 + KJV 对照，复制 / 分享 / 书签 / 笔记 / 四色高亮
- **全文搜索**：关键词搜索，出处直达（如约 3:16）
- **书签 / 高亮 / 笔记 / 最近读过**：全部保存在本机浏览器，可导出 JSON 备份、导入恢复
- **一年读经计划**：365 天打卡；每日金句
- **深色 / 浅色主题**：字号、行距可调

## 一键部署（Cloudflare Pages）

点 README 顶部的 Deploy 按钮，或在 Cloudflare 面板手动操作：

1. Workers & Pages → Create → Pages → Connect to Git
2. 选择 FlareBible 仓库
3. Framework preset 选 None，Build output directory 留空（仓库根目录即网站根目录），不需要构建命令
4. Deploy

部署完成后会得到一个 `*.pages.dev` 域名；要绑定自己的域名，在 Pages 项目 → Custom domains 里添加即可。

## 命令行部署

```bash
npx wrangler pages deploy . --project-name flarebible
```

## 本地运行

```bash
# 任意静态服务器即可，例如：
python3 -m http.server 8080
# 打开 http://localhost:8080
```

## 译本与版权

| 译本 | 来源 | 版权 |
|---|---|---|
| 和合本（简体） | 新标点和合本 | © 1995 Hong Kong Bible Society |
| King James Version | — | 公有领域 |
| 当代译本（简体） | Biblica 开放资源 | © Biblica, Inc.（CC BY-SA 4.0） |
| 吕振中译本（简体） | 1970 年版 | 著作权保护期已满（公有领域）；个别源文本破损处以繁体原文补全 |
| English Standard Version | Crossway 官方 API 实时拉取 | © 2001 by Crossway；本站不存储 ESV 全文 |

ESV 需要读者自己的免费 API 密钥：到 [api.esv.org](https://api.esv.org) 注册账号并创建 API 应用，把密钥填到本站「设置 → ESV API 密钥」里。密钥只保存在本机浏览器，不上传。

微读圣经另有新译本、和合本 2010 等版权译本及有声圣经、灵修资源，本站未收录。

## 译本更新

`scripts/update_translations.py` 每月从上游重新拉取当代译本与吕振中译本并重新转换，只有内容变化时才更新 `data/` 并重新部署。和合本与 KJV 为固定公有领域文本，不参与更新；ESV 每次从官方 API 实时获取，天然最新。用法见 `scripts/README.md`。

## 许可

MIT License，见 [LICENSE](./LICENSE)。经文文本的版权见上表与 LICENSE 末尾说明。
