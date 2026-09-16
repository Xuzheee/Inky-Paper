use super::*;
use crate::paper_planning::{ManualStepChange, Step};

const TASK: &str = "10000000-0000-4000-8000-000000000001";
const TARGET: &str = "10000000-0000-4000-8000-000000000002";
const NEW_TASK: &str = "10000000-0000-4000-8000-000000000003";

fn task(id: &str) -> Task {
    serde_json::from_value(json!({"id":id,"title":"合成任务","due":null,"nextAction":null,"completed":false,"revision":1,"source":"user","createdAt":1,"updatedAt":1,"completedAt":null})).unwrap()
}

fn step(id: &str) -> Step {
    Step {
        id: id.into(),
        task_id: TASK.into(),
        text: "已经完成的步骤".into(),
        expected_result: None,
        planned_seconds: 900,
        completed: true,
        revision: 1,
        source: "user".into(),
        created_at: 1,
        updated_at: 1,
    }
}

fn fixture() -> PaperState {
    PaperState {
        tasks: vec![task(TASK), task(TARGET)],
        notes: vec![json!({
            "id":"note-one","text":"这是原始随手记，保持完整。","createdAt":123,"source":"user",
            "sessionId":"source-session","taskId":TASK,"taskTitle":"原来的标题",
            "action":{"id":"source-step","text":"当时的步骤","completed":false,"source":"user"}
        })],
        planning: crate::paper_planning::PlanningState {
            steps: vec![step("step-b"), step("step-a")],
            ..Default::default()
        },
        ..Default::default()
    }
}

fn ack(s: &PaperState) -> Value {
    json!({"taskId":TASK,"expectedTaskRevision":s.tasks[0].revision,
        "steps":s.planning.steps.iter().filter(|step|step.task_id == TASK).map(|step|json!({"id":step.id,"revision":step.revision})).collect::<Vec<_>>()})
}

fn organize_input(mode: &str, revision: u64) -> Value {
    json!({"noteId":"note-one","expectedRevision":revision,"mode":mode})
}

fn state_value(s: &PaperState) -> Value {
    serde_json::to_value(s).unwrap()
}

fn fails_atomically(s: &mut PaperState, action: &str, input: Value, prefix: &str) {
    let before = state_value(s);
    let error = execute(s, action, &input, "user", 20).unwrap_err();
    assert!(error.starts_with(prefix), "{error}");
    assert_eq!(state_value(s), before);
}

fn completion_session(id: &str, step_id: &str, outcome: &str) -> crate::paper::Session {
    serde_json::from_value(json!({"id":id,"taskId":TASK,"taskTitle":"合成任务",
        "action":{"id":step_id,"text":"当时的文字","completed":false,"source":"user"},
        "taskRevision":1,"kind":"focus","status":"finished","revision":2,
        "plannedSeconds":900,"elapsedSeconds":100,"startedAt":1,"lastResumedAt":null,"endedAt":101,
        "pauseCount":0,"resumeCue":null,"feedback":{"outcome":outcome}}))
    .unwrap()
}

#[test]
fn acknowledgement_validates_the_full_versioned_nonempty_roster() {
    let mut s = fixture();
    let mut input = ack(&s);
    input["steps"].as_array_mut().unwrap().pop();
    fails_atomically(&mut s, "acknowledge_task_completion", input, "CONFLICT:");
    let mut input = ack(&s);
    input["steps"][0]["revision"] = json!(0);
    fails_atomically(&mut s, "acknowledge_task_completion", input, "CONFLICT:");
    let mut input = ack(&s);
    input["steps"][0]["id"] = json!("unrelated-step");
    fails_atomically(&mut s, "acknowledge_task_completion", input, "CONFLICT:");
    let mut input = ack(&s);
    input["steps"][1] = input["steps"][0].clone();
    fails_atomically(
        &mut s,
        "acknowledge_task_completion",
        input,
        "INVALID_INPUT:",
    );
    let mut input = ack(&s);
    input["expectedTaskRevision"] = json!(0);
    fails_atomically(&mut s, "acknowledge_task_completion", input, "CONFLICT:");
    s.planning.steps.clear();
    let input = ack(&s);
    fails_atomically(&mut s, "acknowledge_task_completion", input, "CONFLICT:");
}

#[test]
fn acknowledgement_never_completes_parent_and_reuses_key_after_title_edits() {
    let mut s = fixture();
    let input = ack(&s);
    let first = execute(&mut s, "acknowledge_task_completion", &input, "user", 10).unwrap();
    assert_eq!(
        first["acknowledgement"]["completionKey"],
        json!([TASK, [["step-a", [], []], ["step-b", [], []]]]).to_string()
    );
    assert!(!s.tasks[0].completed);
    assert!(s.sessions.is_empty());
    s.tasks[0].title = "仅调整父任务标题".into();
    s.tasks[0].revision += 1;
    s.planning.steps[0].text = "仅调整步骤标题".into();
    s.planning.steps[0].revision += 1;
    let input = ack(&s);
    let second = execute(&mut s, "acknowledge_task_completion", &input, "user", 30).unwrap();
    assert_eq!(second["reused"], true);
    assert_eq!(first["acknowledgement"], second["acknowledgement"]);
    assert_eq!(s.planning.task_completion_acknowledgements.len(), 1);
    let restored: PaperState = serde_json::from_value(state_value(&s)).unwrap();
    assert_eq!(
        restored.planning.task_completion_acknowledgements[0].completion_key,
        completion_key(&s, TASK)
    );
}

#[test]
fn undo_recompletion_and_added_step_allow_another_acknowledgement() {
    let mut s = fixture();
    let input = ack(&s);
    execute(&mut s, "acknowledge_task_completion", &input, "user", 10).unwrap();
    let old_key = completion_key(&s, TASK);
    for (id, completed) in [("manual-undo", false), ("manual-complete", true)] {
        s.planning.manual_step_changes.push(ManualStepChange {
            id: id.into(),
            task_id: TASK.into(),
            task_title: "合成任务".into(),
            step_id: "step-a".into(),
            step_text: "步骤".into(),
            completed,
            recorded_at: 11,
        });
    }
    assert_ne!(old_key, completion_key(&s, TASK));
    let input = ack(&s);
    execute(&mut s, "acknowledge_task_completion", &input, "user", 20).unwrap();
    let second_key = completion_key(&s, TASK);
    s.planning.steps.push(step("step-c"));
    let input = ack(&s);
    execute(&mut s, "acknowledge_task_completion", &input, "user", 30).unwrap();
    assert_ne!(second_key, completion_key(&s, TASK));
    assert_eq!(s.planning.task_completion_acknowledgements.len(), 1);
    assert_eq!(
        s.planning.task_completion_acknowledgements[0].acknowledged_at,
        30
    );
    s.planning.steps[0].completed = false;
    let input = ack(&s);
    fails_atomically(&mut s, "acknowledge_task_completion", input, "CONFLICT:");
}

#[test]
fn completion_key_includes_only_matching_finished_completions_in_sorted_order() {
    let mut s = fixture();
    s.sessions = vec![
        completion_session("finished-z", "step-a", "step_completed"),
        completion_session("finished-a", "step-a", "step_completed"),
        completion_session("stopped", "step-a", "stopped"),
        completion_session("unrelated-step", "other-step", "step_completed"),
    ];
    let key: Value = serde_json::from_str(&completion_key(&s, TASK)).unwrap();
    assert_eq!(key[1][0][2], json!(["finished-a", "finished-z"]));
    assert_eq!(key[1][1][2], json!([]));
}

#[test]
fn active_sessions_and_completed_parent_block_acknowledgement() {
    let mut s = fixture();
    let mut session = completion_session("active", "step-a", "stopped");
    for status in ["running", "paused", "waiting"] {
        session.status = status.into();
        s.sessions = vec![session.clone()];
        let input = ack(&s);
        fails_atomically(
            &mut s,
            "acknowledge_task_completion",
            input,
            "ACTIVE_SESSION:",
        );
    }
    s.sessions.clear();
    s.tasks[0].completed = true;
    let input = ack(&s);
    fails_atomically(
        &mut s,
        "acknowledge_task_completion",
        input,
        "TASK_COMPLETED:",
    );
}

#[test]
fn keep_and_link_preserve_raw_text_and_snapshot_origin() {
    let mut s = fixture();
    let raw = s.notes[0].clone();
    let kept = execute(
        &mut s,
        "organize_note",
        &organize_input("keep", 1),
        "user",
        20,
    )
    .unwrap();
    assert_eq!(kept["note"]["organization"], "kept");
    assert_eq!(kept["note"]["revision"], 2);
    let mut link = organize_input("link", 2);
    link["targetTaskId"] = json!(TARGET);
    link["expectedTaskRevision"] = json!(1);
    let linked = execute(&mut s, "organize_note", &link, "user", 30).unwrap();
    assert_eq!(linked["note"]["linkedTaskId"], TARGET);
    assert_eq!(linked["task"]["id"], TARGET);
    assert_eq!(linked["note"]["revision"], 3);
    for field in [
        "id",
        "text",
        "createdAt",
        "source",
        "sessionId",
        "taskId",
        "taskTitle",
        "action",
    ] {
        assert_eq!(linked["note"][field], raw[field], "{field}");
    }
    assert_eq!(s.tasks.len(), 2);
    assert!(s.sessions.is_empty());
    assert!(linked.get("state").is_none());
}

#[test]
fn link_checks_note_and_target_revisions_without_partial_writes() {
    let mut s = fixture();
    let mut input = organize_input("link", 1);
    input["targetTaskId"] = json!(TARGET);
    input["expectedTaskRevision"] = json!(0);
    fails_atomically(&mut s, "organize_note", input.clone(), "CONFLICT:");
    input["expectedTaskRevision"] = json!(1);
    input["expectedRevision"] = json!(0);
    fails_atomically(&mut s, "organize_note", input.clone(), "CONFLICT:");
    input["expectedRevision"] = json!(1);
    input["targetTaskId"] = json!("unknown-target");
    fails_atomically(&mut s, "organize_note", input, "NOT_FOUND:");
    s.notes[0]["revision"] = json!("bad");
    fails_atomically(
        &mut s,
        "organize_note",
        organize_input("keep", 1),
        "INVALID_STATE:",
    );
}

#[test]
fn convert_defaults_only_title_and_keeps_complete_original_text() {
    let mut s = fixture();
    let original = "汉字🙂".repeat(180);
    s.notes[0]["text"] = json!(original);
    let raw = s.notes[0].clone();
    let result = execute(
        &mut s,
        "organize_note",
        &organize_input("convert", 1),
        "user",
        20,
    )
    .unwrap();
    assert_eq!(
        result["task"]["title"].as_str().unwrap().chars().count(),
        300
    );
    assert_eq!(result["note"]["text"], original);
    assert_eq!(result["note"]["organization"], "converted");
    assert_eq!(result["note"]["convertedTaskId"], result["task"]["id"]);
    assert_eq!(result["task"]["nextAction"], Value::Null);
    assert_eq!(result["task"]["completed"], false);
    for field in [
        "id",
        "createdAt",
        "source",
        "sessionId",
        "taskId",
        "taskTitle",
        "action",
    ] {
        assert_eq!(result["note"][field], raw[field], "{field}");
    }
    assert_eq!(s.tasks.len(), 3);
    assert!(s.planning.day_items.is_empty());
    assert!(s.sessions.is_empty());
}

#[test]
fn conversion_reuses_existing_target_and_cannot_redirect_origin() {
    let mut s = fixture();
    let mut input = organize_input("convert", 1);
    input["taskId"] = json!(NEW_TASK);
    input["title"] = json!("从笔记整理的任务");
    input["nextAction"] = json!("第一个行动");
    let first = execute(&mut s, "organize_note", &input, "user", 20).unwrap();
    assert_eq!(first["task"]["nextAction"]["text"], "第一个行动");
    fails_atomically(&mut s, "organize_note", input.clone(), "CONFLICT:");
    input["expectedRevision"] = json!(2);
    input["taskId"] = json!(TARGET);
    input["title"] = json!("不能改写已有目标");
    let second = execute(&mut s, "organize_note", &input, "user", 30).unwrap();
    assert_eq!(second["reused"], true);
    assert_eq!(first["task"], second["task"]);
    assert_eq!(first["note"], second["note"]);
    assert_eq!(s.tasks.len(), 3);
    fails_atomically(
        &mut s,
        "organize_note",
        organize_input("keep", 2),
        "CONFLICT:",
    );
    let mut link = organize_input("link", 2);
    link["targetTaskId"] = json!(TARGET);
    link["expectedTaskRevision"] = json!(1);
    fails_atomically(&mut s, "organize_note", link, "CONFLICT:");
}

#[test]
fn legacy_converted_note_is_normalized_without_creating_another_task() {
    let mut s = fixture();
    s.notes[0]["convertedTaskId"] = json!(TARGET);
    let result = execute(
        &mut s,
        "organize_note",
        &organize_input("convert", 1),
        "user",
        20,
    )
    .unwrap();
    assert_eq!(result["task"]["id"], TARGET);
    assert_eq!(result["reused"], true);
    assert_eq!(result["note"]["revision"], 2);
    assert_eq!(s.tasks.len(), 2);
}

#[test]
fn invalid_conversion_or_duplicate_task_id_is_atomic() {
    let mut s = fixture();
    let mut input = organize_input("convert", 1);
    input["taskId"] = json!(TARGET);
    fails_atomically(&mut s, "organize_note", input.clone(), "CONFLICT:");
    input["taskId"] = json!(NEW_TASK);
    input["nextAction"] = json!("长".repeat(301));
    fails_atomically(&mut s, "organize_note", input.clone(), "INVALID_INPUT:");
    input["nextAction"] = Value::Null;
    s.notes[0]["revision"] = json!(u64::MAX);
    input["expectedRevision"] = json!(u64::MAX);
    fails_atomically(&mut s, "organize_note", input, "INVALID_STATE:");
}

#[test]
fn non_user_sources_are_denied_before_lookup_or_mutation() {
    let mut s = fixture();
    let before = state_value(&s);
    for source in ["hermes", "agent", "system", ""] {
        for operation in ["acknowledge_task_completion", "organize_note"] {
            assert!(execute(&mut s, operation, &json!({}), source, 20)
                .unwrap_err()
                .starts_with("FORBIDDEN:"));
        }
    }
    assert_eq!(state_value(&s), before);
}

#[test]
fn public_transaction_caches_conversion_and_legacy_create_path_reuses_it() {
    let mut c = crate::paper::open(std::path::Path::new(":memory:")).unwrap();
    c.execute(
        "UPDATE paper_state SET data=?1 WHERE id=1",
        [state_value(&fixture()).to_string()],
    )
    .unwrap();
    let mut input = organize_input("convert", 1);
    input["requestId"] = json!(uuid::Uuid::new_v4().to_string());
    input["taskId"] = json!(NEW_TASK);
    let (first, changed) =
        crate::paper::execute(&mut c, "organize_note", input.clone(), "user").unwrap();
    assert!(changed);
    let (retry, changed) = crate::paper::execute(&mut c, "organize_note", input, "user").unwrap();
    assert!(!changed);
    assert_eq!(first, retry);
    let (legacy,_) = crate::paper::execute(&mut c,"create_task",json!({"requestId":uuid::Uuid::new_v4().to_string(),
        "taskId":uuid::Uuid::new_v4().to_string(),"title":"不得生成第二项","originNoteId":"note-one"}),"user").unwrap();
    assert_eq!(legacy["task"]["id"], NEW_TASK);
    let state = crate::paper::load(&c).unwrap();
    assert_eq!(state.tasks.len(), 3);
    assert_eq!(state.notes[0]["organization"], "converted");
    assert_eq!(state.notes[0]["convertedTaskId"], NEW_TASK);
    assert_eq!(state.notes[0]["revision"], 2);
}
