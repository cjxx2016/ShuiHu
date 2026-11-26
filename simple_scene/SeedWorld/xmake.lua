-- 测试程序 - SeedWorld: sokol 渲染基础用例 (game 系列第 1 例)
--
-- 着色器使用 sokol-shdc 编译为 sokol_gfx 头文件。
-- shdc 取自 Depend/sokol-tools-bin-master, 与 Depend/sokol 头文件同步更新。
-- 生成放在目标自动生成目录中, 仅在 .glsl 更新时重编译, 保持增量构建速度。
local function seedworld_shdc()
    if is_host("windows") then
        return path.join(os.projectdir(), "..", "Depend", "sokol-tools-bin-master", "bin", "win32", "sokol-shdc.exe")
    elseif is_host("macosx") then
        return path.join(os.projectdir(), "..", "Depend", "sokol-tools-bin-master", "bin", "osx_arm64", "sokol-shdc")
    else
        return path.join(os.projectdir(), "..", "Depend", "sokol-tools-bin-master", "bin", "linux", "sokol-shdc")
    end
end

AddTest("SeedWorld",
    Link_imgui,
    function ()
        add_defines("NOMINMAX")

        on_load(function (target)
            local genDir = path.join(target:autogendir(), "shaders")
            local shaderSrc = path.join(os.scriptdir(), "shaders", "seedworld.glsl")
            local shaderHdr = path.join(genDir, "seedworld.glsl.h")

            target:add("includedirs", target:autogendir())

            if not os.exists(shaderHdr) or os.mtime(shaderSrc) > os.mtime(shaderHdr) then
                os.mkdir(genDir)
                os.runv(seedworld_shdc(), {"--input", shaderSrc, "--output", shaderHdr,
                                           "--slang", "glsl410:hlsl5:metal_macos"})
            end
        end)
    end
)
