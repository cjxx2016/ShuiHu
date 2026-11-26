# SeedWorld — sokol 渲染基础用例 (game 系列第 1 例)

以桌面参考场景 `seedworld-tree-house.html` 为蓝本, 用 **sokol_app + sokol_gfx +
sokol_imgui** 复现并整理出的统一色块柔光体素渲染。它是 game 系列的首个用例,
目标是展示 sokol 的核心能力, 并为后续真实项目提供可复制的渲染基座。

在此之上增加了 **WY=256 的巨型地形** 与可组合地形源: 平原、丘陵、长条山脊、
河谷、不同大小的台地, 以及山地针叶林、村庄与庙宇。程序化地形、设计平台与
运行时高度编辑共享同一套网格/烘焙/着色管线。

## 构建与运行

```bash
m dbg SeedWorld      # 调试构建 (首次会先构建 Base)
m rel SeedWorld      # 发布构建
m run SeedWorld      # 运行 (程序输出到 env/SeedWorld.exe)
```

> 本机提示: 若命令行未加载 Visual Studio 环境, `xmake` 可能落到 mingw 并在
> `cc/Base/Py/NLPy.cc` 的 `<crypt.h>` 上失败。请从 VS 2022 x64 开发者命令提示符
> 运行, 或先执行 `vcvars64.bat` 后配置 `xmake f --plat=windows --toolchain=msvc`。

着色器由 `Depend/sokol-tools-bin-master` 中的 `sokol-shdc` 在配置阶段编译,
生成头文件位于构建目录的 `.gens` 下; 修改 `shaders/seedworld.glsl` 后重新
执行构建命令即可自动重编。

渲染后端: Windows 使用 **D3D11** (由 sokol_gfx 原生呈现, 与 sokol_imgui 一致),
其他桌面平台使用 **GL core**; 投影矩阵按后端选择 NDC 深度范围, 着色器同时
交叉编译到 HLSL5 / GLSL410 / Metal, 便于后续扩展。

## 操作

| 操作 | 功能 |
| --- | --- |
| 鼠标左键拖拽 | 环绕 |
| 鼠标右键 / 中键拖拽 | 平移 |
| 滚轮 | 缩放 |
| `WASD` | 水平移动 (贴地) |
| `Q` / `E` | 降低 / 升高离地高度 |
| `Shift` | 移动加速 |
| `H` | 显示 / 隐藏界面 |
| `Esc` | 退出 |

界面右侧提供一键方案 (柔和纯色 / 博客原版 / 风格化+ / 五重塔)、六种天光遮蔽
算法、物体色流、风格化模块开关、昼夜时间轴、相机预设 (雪山远眺/河谷村庄/
山脊庙宇)、加载半径、自动半径、预取开关、远景简化、自动漫游与"隆起演示山丘"
(动态地形编辑)。相机越高/离目标越远, 自动加载半径从 2 递增到 5。

可选命令行参数 (便于批量验证):

```
SeedWorld.exe --mode 3 --tod 0.72
SeedWorld.exe --radius 4 --no-wind --fog              # 固定半径
SeedWorld.exe --camera 5 --no-wind --fog              # 雪山远眺 (自动视距)
SeedWorld.exe --camera 6 --no-wind --fog              # 河谷村庄
SeedWorld.exe --camera 7 --no-wind --fog              # 山脊庙宇
SeedWorld.exe --target -200 -100 --target-ground --yaw 0.7 --pitch 0.95 --dist 700
SeedWorld.exe --target -400 200 --target-ground --yaw 0.7 --pitch 0.5 --dist 180
SeedWorld.exe --edit-demo --edit-at 4 --radius 0
SeedWorld.exe --target 40 4 --yaw 1.57 --pitch 0.12 --dist 30
SeedWorld.exe --bench 45 --radius 4 --verbose --fog
SeedWorld.exe --bench 20 --speed 20 --verbose --fog   # 贴地自动漫游
SeedWorld.exe --bench 20 --radius 4 --speed 30 --verbose --fog
```

| 参数 | 说明 |
| --- | --- |
| `--mode N` | 天光遮蔽模式 0..5 |
| `--preset N` | 一键方案 0..3 |
| `--tod F` | 昼夜时间 0.20..0.92 |
| `--radius N` | 固定加载半径 0..5 (关闭自动视距) |
| `--roam` | 沿 +X 自动漫游 (流送演示) |
| `--speed N` | 漫游速度 m/s (2..30) |
| `--no-prefetch` | 关闭活动窗口外一圈预取 (仅用于基线对比) |
| `--bench N` | 漫游 N 秒并在退出时打印 BENCH/卡顿汇总 |
| `--camera N` | 相机预设 (5=雪山远眺, 6=河谷村庄, 7=山脊庙宇) |
| `--target-ground` | 将 `--target` 的 y 吸附到地形高度 |
| `--lock-camera` | 锁定机位, 忽略鼠标扰动 (批量截图/基准) |
| `--edit-demo` | 启动后演示一次动态地形编辑 (默认 6s) |
| `--edit-at F` | 指定动态编辑触发时刻 (秒) |
| `--verbose` | 打印逐分块加载/卸载日志 |
| `--fog` / `--no-wind` / `--no-far-lod` | 强制开雾 / 关闭风动 / 关闭远景简化 |
| `--no-vsync` / `--width N` / `--height N` | 基准辅助: 关垂直同步 / 窗口尺寸 |
| `--target X Z --yaw --pitch --dist` | 覆盖相机并锁定机位, 便于固定机位验证 |

## 渲染要点

- **可组合地形源**: `Terrain.h/.cc` 定义 `TerrainSource` 纯虚接口与四种实现:
  `ProceduralTerrain` (平原/丘陵/山脊/河谷)、`PatchedTerrain` (设计补丁)、
  `LeveledTerrain` (把村庄/庙宇用地平滑拉平到绝对高度)、`EditedTerrain`
  (运行时高度编辑)。它们都是不可变快照, 可被多个 worker 共享;
  `WorldPartition::SetTerrainSource` 可热替换并重建分块。
- **巨型地形 2.0**: 世界高度 `WY=256`, 软上限 248, 实测 **6..209**。
  英雄区 100m 内保持参考草甸, 外围由域扰动 ridged multifractal 形成有走向的
  山脊, 范围带与西北设计山脉包络避免"圆柱山"; 平坦区宽度随区域变化; 两级
  河网沿噪声等值线切出宽窄不同的河谷, 低处形成水面。高处按海拔/坡度生成
  岩石、深色岩层与积雪; 针叶树可长到 186m, 岩石到 225m。
- **无限世界 / 世界分区**: 世界按 80x80 的 XZ 分块生成, 核心之外带 24 体素
  光晕用于射线/AO/剔除; 地形、溪流、生态色场是全局解析函数, 英雄区 (大树/
  小屋/树苗/野花) 与外围分块的树木/石块/野花均由全局坐标确定性生成。
  分块坐标可为负数, 世界无界。
- **异步流送 + 自动视距**: 4 个 worker 在后台生成分块并烘焙, 主线程每帧上传
  1 块 GPU 资源。活动窗口半径按相机视距自动分级 2..5:
  `range = camera.distance + max(0, eyeY-20)`, 扩大立即生效, 缩小每 2s 降一级;
  半径0为不预取的纯基线模式。窗口外再预取一圈: 移动时按速度方向预取最多
  8 块完整质量, 空闲补 6 块轻量 LOD, 移动时淘汰身后预取; 半径5最外圈使用
  Prefetch 烘焙 LOD。相机的 render origin 每 80m 重定基。
- **远景 LOD**:
  - 烘焙: 空闲预取用 24/18 射线 + 1x1x1 常量彩光体积, 进入活动窗口后升级为
    48/34 射线 + 完整 3D 彩光; 旧网格保留到新网格上传完成, 无空洞。
  - 着色: 300m 外关闭 3D 彩光采样、树冠 SSS、棱角倒角与水面折射;
    基色、天光、生态色流、雾与雪线保持, 观感统一。
  - 高度雾: 相机高于 150m 自动叠加 0..0.45 的雾化, 远景更柔和; far plane
    1600 / 天空球 1200。
- **近处不降级**: 活动窗口内使用完整的 80x80 核心网格与 48 射线烘焙, 没有
  几何 LOD (无 LOD 裂缝); 英雄块在 radius 0/2/4 下的墙面/踏脚石区域逐像素
  一致, 关闭预取/远景 LOD 时四个静态区域与入山前基线完全一致。
- **聚落**: `Settlement.h/.cc` 在 420m 网格上按局部平坦度/海拔确定性选址;
  平原/河谷生成村庄, 山脊台地生成庙宇。固定地标为河谷村庄 (300,120) 与
  山脊庙宇 (-410,-120), 位于 `TerrainPad` 拉平的台地; 村庄含多座小屋/石台/
  灯柱, 庙宇为双层屋顶塔。树木/花草自动避开聚落半径。
- **世界内容**: 英雄区草甸/溪流/大树/小屋/树苗/野花; 外围平原、丘陵、山脊、
  河谷、针叶林、岩石、村庄与庙宇。所有材质严格使用单一固定基色, 无贴图噪点。
- **烘焙**: 每个分块独立执行 48 射线黄金螺旋天光可见度 (平滑/原始两套口径) +
  34 射线五重塔口径 + 四角 AO + 弯曲法线 + 树叶厚度/地面与水体邻近度,
  生成该分块的静态顶点/索引缓冲与 3D 彩光体积。高海拔岩石/积雪同样参与
  彩光溢色 (雪面额外提供冷色反弹)。切片按最高实体/最低地表裁剪候选范围,
  WY256 + 复杂地形下 release 每块平均约 234ms (4 worker)。
- **光照**: 六种模式 (纯色 / 直光+AO / 原版逐面 / 柔和连续 / 五重塔 / 高饱和),
  配合生态色流、GGX 棱角倒角、3D 洪水填充彩光溢色、树冠 SSS、接缝描线、
  指数雾与自发光窗光。
- **3D 纹理**: 彩光溢色体积以半分辨率 RGBA8 3D 纹理上传, 片元着色器用
  `sampler3D` 三线性采样。
- **水体**: 独立半透明网格, 含波动顶点、菲涅尔、Beer-Lambert 深度吸收、
  焦散、太阳高光与岸边泡沫。
- **天空与后处理**: 以相机为中心的 1200 半径天空球, far plane 1600,
  远景山脊可见;
  场景渲染到线性 RGBA16F 离屏目标, 再经移轴景深 + three.js 同款 ACES +
  sRGB 输出。ImGui 在最终交换链 pass 中绘制, 不受景深影响。
- **绘制效率**: 不透明分块由近到远绘制以利用 early-Z, 水面反向绘制;
  远景着色 LOD 与预取烘焙 LOD 降低远处开销。45s 固定半径4: 102 块加载峰值 /
  2344 万体素 / 135 万三角 / 53 draw / 142 FPS; 高空自动半径5: 121 块 /
  3.66M 三角 / 119 draw / 144 FPS。
- **移动**: 自动漫游目标贴地 (`HeightAt + walkHeight`), 不再固定高度穿越山体;
  WASD 沿相机朝向移动并贴地, Q/E 调整离地高度, Shift 加速; 相机眼位低于
  所在位置地表时自动抬高。移动键在 ImGui 之前处理。
- **动作/光效钩子**: 树叶/草/野花顶点风动 (全局相位, 分块缝合稳定), 水面
  波动/焦散, 昼夜天光时间轴, 指数雾, 每分块独立彩光体积; 为后续骨骼动画与
  局部光源预留了按分块传 uniform 的接口。

## 代码结构

```
SeedWorld.cc        应用入口、sokol 回调、漫游/基准、昼夜时间轴、ImGui HUD
Terrain.h/.cc       可组合地形源 (程序化山脊/河谷、设计补丁/平台、动态编辑)
Settlement.h/.cc    村庄/庙宇选址与台地
World.h/.cc         单个分块的体素世界 (核心 + 光晕)、生态/邻近度数据 (纯 CPU)
Mesher.h/.cc        分块表面网格烘焙、彩光体积、水面网格
WorldPartition.h/.cc 后台分块队列、地形源版本、主线程限量上传、加载窗口/卸载
Renderer.h/.cc      多分块 sokol_gfx 资源、视锥剔除、四个绘制阶段、离屏后处理
OrbitCamera.h       球面环绕相机与预设过渡
Common.h            最小数学/颜色工具
shaders/seedworld.glsl  voxel / water / sky / post 四个着色器程序
evidence/           流送/山脉/质量/边界截图与 45s 基准日志、EVIDENCE.md
```

## 可作为后续项目基础的部分

- `sokol_main` → `init/frame/cleanup/event` 的标准生命周期;
- 顶点/索引缓冲、管线、uniform block、纹理与 3D 纹理、采样器、离屏目标;
- sokol_imgui 的 `new_frame → flush → draw` 正确调用顺序;
- 构建期 GLSL 交叉编译 (GL 4.1 / HLSL5 / Metal) 与增量构建;
- 烘焙式全局光照 + 自定义后处理的完整数据通路;
- 可组合地形源 + 版本化异步分块重建, 为程序化/手工/动态编辑混合提供基础。

扩展建议: 在 `WorldPartition` 之上增加磁盘缓存/预烘焙与 LOD 分级; 在
`Renderer` 中追加 G-buffer + SSGI/Lumen-lite、阴影贴图、Bloom 或 GPU 粒子;
将 HUD 状态与游戏逻辑解耦。当前限制: sokol_gfx 无 indirect draw, 只有分块级
CPU 剔除, 尚未实现 cluster 级 Nanite 式剔除。

## 效果证据

`evidence/EVIDENCE.md` 记录了 45s 固定半径4 基准 (450m / 169 块构建 /
102 块加载峰值 / 2344 万已加载体素 / 1095 万可见体素 / 135 万三角 / 53 draw /
142 FPS)、20s 贴地自动漫游 (targetY 14..30, slow33=0), 以及自动视距表
(地面38块 → 高空121块)。英雄区墙面/踏脚石在 radius 0/2/4 下逐像素为 0,
radius0 四区域与入山前基线一致。`vista_r4.png` 雪山, `village_r4.png` 村庄,
`temple_r4.png` 庙宇, `river_r4.png` 河谷, `overview_high.png` 高空自动视距,
`keyboard_move_before/after.png` 键盘移动前后, `roam_auto.png` 贴地漫游。
