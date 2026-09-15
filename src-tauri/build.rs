fn main() {
    println!("cargo:rerun-if-changed=../integrations/inky-paper-mcp-server/index.mjs");
    println!("cargo:rerun-if-changed=../scripts/build-workbench-mcp.mjs");
    let status = std::process::Command::new("node")
        .arg("scripts/build-workbench-mcp.mjs")
        .current_dir("..")
        .status()
        .expect("Node.js is required to bundle the workbench MCP server");
    assert!(
        status.success(),
        "Could not bundle workbench MCP server; install pnpm dependencies first"
    );
    tauri_build::build()
}
