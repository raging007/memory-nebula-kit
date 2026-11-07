# 插件清单工具 / Plugin inventory tools

[中文](#中文) | [English](#english)

## 中文

主机导出插件清单，服务器读取并按清单安装/配置：

```powershell
# 主机：生成 config/plugins.json（需要 DSH_PROFILE_DIR）
node tools/export-plugins-manifest.mjs -o <数据仓>/config/plugins.json

# 服务器：读取清单，生成安装/配置计划
powershell -NoProfile -ExecutionPolicy Bypass -File tools/apply-plugins-manifest.ps1 `
  -Manifest <数据仓>\config\plugins.json -ProfileDir $env:DSH_PROFILE_DIR

# 服务器：应用记忆星图的设置（可选）
powershell ... -ApplyMemory -DshUrl $env:DSH_WEB_URL
```

计划里的 `install` 交给服务器上的 DSH agent 执行 `plugin_manager install_bundle`；`configs` 在 DSH 设置页应用；MCP 与本地 link 包会被标记、不会自动下发。

## English

The main device exports an inventory; the server reads it and installs/configures from the plan:

```powershell
# main device
node tools/export-plugins-manifest.mjs -o <data-repo>/config/plugins.json

# server
powershell -NoProfile -ExecutionPolicy Bypass -File tools/apply-plugins-manifest.ps1 `
  -Manifest <data-repo>\config\plugins.json -ProfileDir $env:DSH_PROFILE_DIR

# optional: apply the memory settings
powershell ... -ApplyMemory -DshUrl $env:DSH_WEB_URL
```

Feed the `install` entries to the DSH agent (`plugin_manager install_bundle`); apply `configs` in the DSH Settings pages. MCP connections and local link packages are flagged and never installed automatically.
