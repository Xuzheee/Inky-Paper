//! Read the actual journal files without rewriting them or importing their contents.
use crate::{paper::PaperDb, paper_markdown::document_path};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{fs::File, io::Read, time::UNIX_EPOCH};

const DOCUMENT_LIMIT: u64 = 2 * 1024 * 1024;

fn read_document(c: &Connection, date: &str, kind: &str) -> Result<Value, String> {
    let path = document_path(c, date, kind)?;
    let mut document =
        json!({"kind":kind,"path":path,"exists":false,"content":"","modifiedAt":null,"error":null});
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(document),
        Err(e) => {
            document["error"] = json!(format!("无法读取原文件：{e}"));
            return Ok(document);
        }
    };
    document["exists"] = json!(true);
    if let Ok(metadata) = file.metadata() {
        document["modifiedAt"] = json!(metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64));
    }
    let mut bytes = Vec::new();
    if let Err(e) = file.take(DOCUMENT_LIMIT + 1).read_to_end(&mut bytes) {
        document["error"] = json!(format!("无法读取原文件：{e}"));
    } else if bytes.len() as u64 > DOCUMENT_LIMIT {
        document["error"] = json!("文件超过 2MB，请点击打开原文件查看完整内容。");
    } else {
        match String::from_utf8(bytes) {
            Ok(content) => document["content"] = json!(content),
            Err(_) => document["error"] = json!("文件不是 UTF-8 编码，请打开原文件查看。"),
        }
    }
    Ok(document)
}

#[tauri::command]
pub fn workbench_read_documents(db: tauri::State<PaperDb>, date: String) -> Result<Value, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    let documents = ["day", "personal", "tasks"]
        .iter()
        .map(|kind| read_document(&c, &date, kind))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({"date":date,"documents":documents}))
}

#[tauri::command]
pub fn workbench_open_document(
    db: tauri::State<PaperDb>,
    date: String,
    kind: String,
) -> Result<(), String> {
    let path = {
        let c = db.0.lock().map_err(|e| e.to_string())?;
        document_path(&c, &date, &kind)?
    };
    if !path.is_file() {
        return Err("这一天还没有对应的 Markdown 文件".into());
    }
    #[cfg(windows)]
    let command = "explorer.exe";
    #[cfg(not(windows))]
    let command = "xdg-open";
    std::process::Command::new(command)
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_text_and_external_edits_are_read_without_writing_or_creating_days() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::paper::open(&dir.path().join("paper.sqlite3")).unwrap();
        let date = "2025-01-02";
        let path = document_path(&c, date, "day").unwrap();
        assert_eq!(read_document(&c, date, "day").unwrap()["exists"], false);
        assert!(!path.exists());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let original = "# 原始记录\r\n\r\n- [x] 保留手写内容 <script>文本</script>\r\n";
        std::fs::write(&path, original).unwrap();
        assert_eq!(read_document(&c, date, "day").unwrap()["content"], original);
        std::fs::write(&path, "外部编辑器改过的内容").unwrap();
        assert_eq!(
            read_document(&c, date, "day").unwrap()["content"],
            "外部编辑器改过的内容"
        );
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "外部编辑器改过的内容"
        );
        assert!(read_document(&c, "../2025-01-02", "day").is_err());
        assert!(read_document(&c, date, "../../private").is_err());
        std::fs::write(&path, vec![b'a'; DOCUMENT_LIMIT as usize + 1]).unwrap();
        let oversized = read_document(&c, date, "day").unwrap();
        assert!(oversized["error"].is_string());
        assert_eq!(oversized["content"], "");
    }
}
