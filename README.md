# StoryTavern · 故事酒馆

基于 [Chatbox](https://github.com/chatboxai/chatbox) 的故事创作客户端，支持 Windows 和 Android。上游基线为 `0ac6385ae1ff5bf778777826da3c5edcd55b61b8`，本仓库包含故事工作台及移动端适配；这是个人衍生项目。

## 功能

- 世界与角色素材库，支持自然语言、Markdown、JSON、PNG 角色卡和 JSON 世界书导入。
- 导入 TXT / HTML 故事，预览分段与角色；编辑消息、另存分支、继续剧情。
- 故事设定、写作风格、提示目标字数、固定事实与自动/手动记忆。
- JSON 备份保留故事、素材、附件和接口配置，默认排除密钥和认证信息。
- Windows 独立数据目录；Android 使用本地界面、存储和原生网络组件。

阅读、导入和设定编辑可以离线使用，AI 生成需要配置自己的模型服务。API 密钥在客户端中填写，不随源码分发。预设模型名称不保证服务可用，请按实际接口修改。

## 从源码构建

需要 Node.js 22、pnpm 10.33；Android 另需完整 JDK 21、SDK Platform 35、Build Tools 35.0.0。首次先安装依赖：

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm exec vitest run src/renderer/tavern src/shared/tavern
```

Windows：

```powershell
./scripts/tavern-build.ps1 -Target windows
```

Android：先设置 `JAVA_HOME`、`ANDROID_SDK_ROOT`，再运行：

```powershell
$env:CHATBOX_BUILD_TARGET='mobile_app'
$env:CHATBOX_BUILD_PLATFORM='android'
pnpm run build:renderer
pnpm exec cap sync android
# 在 android/local.properties 配置 sdk.dir（不要提交此文件）
./android/gradlew.bat -p android assembleDebug
```

调试 APK 在 `android/app/build/outputs/apk/debug/`。发行签名可使用 `scripts/tavern-build.ps1 -Target android -KeyStorePath <你的签名文件>`，密码通过 `TAVERN_SIGN_PASSWORD` 环境变量传入，密钥不属于源码。`-Offline` 只适用于 Gradle 依赖已缓存的环境。

## 使用与边界

详见[使用说明](docs/STORY_TAVERN_GUIDE.md)。自动记忆可能漏记，字数是提示目标；其他酒馆插件的脚本不会自动执行。设备间采用手动备份，不含自动同步。测试目录包含导入、故事分支、记忆和备份等用例；模拟测试不替代设备实测。

## 许可证和来源

遵循仓库原有 [GPL-3.0](LICENSE)，保留 Chatbox 及其贡献者的版权声明。上游介绍见 [README_UPSTREAM.md](README_UPSTREAM.md)。本次以独立源码快照整理，未携带本机数据、接口密钥或签名资料。

上游桌面统计服务的内置凭据已移除；未设置 `STORY_TAVERN_ANALYTICS_SECRET` 时不会发送该模块的统计请求。
