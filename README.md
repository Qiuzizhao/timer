# Timer

一个基于 Expo / React Native 的移动端计时器应用。支持开始、暂停、加时与"时间到"提醒，并通过系统通知在 App 进入后台或被关掉时也能如期响铃。

## 功能

- 倒计时开始 / 暂停 / reset
- 一键加一分钟（+1min），带语音提示
- 提醒音效（启动提示、秒数滴答、结束响铃）可整体开关
- **后台 & 杀进程提醒**：App 在前台时由应用内闹钟触发；进入后台或被系统关闭时，由操作系统推送本地通知保证准时提醒
- 轻量手势、回弹动画与震动反馈

## 技术栈

- [Expo](https://expo.dev)（SDK 54）+ Expo Router
- React Native 0.81 + React 19
- TypeScript
- `expo-notifications` 实现本地通知闹钟
- `expo-audio` 播放提示音 / 滴答 / 铃声
- `expo-haptics` 震动反馈

## 开始使用

```bash
npm install
npm start
```

用 Expo Go 扫码预览，或运行原生构建：

```bash
npm run android
npm run ios
```

## 目录结构

```
app/                  Expo Router 路由入口
src/
  features/daily/timer/       计时器核心功能
  shared/                     主题、工具、通用组件
plugins/             iOS 自定义 config plugin（Scene Lifecycle、Pod 部署目标）
scripts/             计时器逻辑 / 音效 / 加时语音测试脚本
assets/              图标、启动图等资源
```

## 构建与发布（EAS）

项目使用 [EAS Build](https://docs.expo.dev/build/introduction/) 进行云端构建，配置见 `eas.json`：

- `preview`：内部测试，Android 产出 APK
- `production`：生产构建，版本号自动递增
- 应用标识：`com.qiuzizhao.timer`（iOS / Android 一致）

```bash
npx eas build --profile preview --platform android
npx eas build --profile production --platform all
```

## 测试

```bash
npm run typecheck   # TypeScript 类型检查
npm run lint        # ESLint
npm run test:timer  # 计时核心逻辑 / 音效 / 时间计算 / 加时语音
```

## 备注

- iOS 通过 `UIBackgroundModes: audio` 让 JS 计时在后台保持存活，并配有自定义 `SceneDelegate` 插件
- Android 采用系统本地通知作为后台 / 杀进程时的保底提醒

## 本地构建注意事项（Windows）

### 1. 使用符合要求的 JDK

Gradle / EAS 原生构建需要 JDK 17+。本机默认的 `JAVA_HOME` 指向 JDK 8，直接构建会报
`Dependency requires at least JVM runtime version 11`。

推荐使用 JDK 17（已安装在：
`C:\Users\Qiuzizhao\.codex\tools\jdk17\jdk-17.0.20.1+1`），构建前指向它：

```powershell
$env:JAVA_HOME = "C:\Users\Qiuzizhao\.codex\tools\jdk17\jdk-17.0.20.1+1"
```

### 2. 短路径临时目录（本机特有）

本机 Windows 的 Unix 域套接字对较长路径的客户端连接会被拦截，凡是使用 NIO 选择器的
JVM（JDK 17+/21，包括 Android Studio / DevEco 自带的 JBR）在跑 Gradle 时都会报：

```
java.io.IOException: Unable to establish loopback connection
Caused by: java.net.SocketException: Invalid argument: connect
```

解决办法：构建前把 `TEMP` / `TMP` 指向一个尽量短的绝对路径目录，例如 `C:\TimerTmp`：

```powershell
$env:TEMP = "C:\TimerTmp"
$env:TMP  = "C:\TimerTmp"
```

再运行 `npm run android` 即可正常构建。
