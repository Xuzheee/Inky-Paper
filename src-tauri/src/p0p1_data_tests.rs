use super::*;
fn request(mut value: Value) -> Value {
    value["requestId"] = json!(id());
    value
}
fn call(c: &mut Connection, op: &str, value: Value) -> Value {
    execute(c, op, request(value), "user").unwrap().0
}
fn save(c: &mut Connection, date: &str) -> Value {
    call(
        c,
        "workbench_save_step",
        json!({"taskId":id(),"stepId":id(),"title":"合成计划","text":"画草图","category":"work","priority":"high","due":"客户确认后","dueDate":"2030-03-08","expectedResult":"三列布局可检查","plannedSeconds":900,"date":date}),
    )
}
fn item_request(out: &Value) -> Value {
    json!({"taskId":out["task"]["id"],"stepId":out["step"]["id"],"expectedTaskRevision":out["task"]["revision"],"expectedStepRevision":out["step"]["revision"],"items":[{"id":out["item"]["id"],"revision":out["item"]["revision"]}]})
}

#[test]
fn optional_metadata_roundtrips_and_invalid_date_rolls_back() {
    let mut c = open(Path::new(":memory:")).unwrap();
    let initial = save(&mut c, "2030-03-04");
    let edit = json!({"taskId":initial["task"]["id"],"stepId":initial["step"]["id"],"expectedTaskRevision":1,"expectedStepRevision":1,"title":"改名","text":"改步骤","category":"study","plannedSeconds":1200});
    let updated = call(&mut c, "workbench_save_step", edit.clone());
    assert_eq!(updated["task"]["dueDate"], "2030-03-08");
    assert_eq!(updated["task"]["priority"], "high");
    assert_eq!(updated["task"]["due"], "客户确认后");
    assert_eq!(updated["step"]["expectedResult"], "三列布局可检查");
    let before = serde_json::to_value(load(&c).unwrap()).unwrap();
    for date in ["2030-02-30", "2030-3-04", "明天"] {
        let invalid = request(
            json!({"taskId":initial["task"]["id"],"expectedRevision":2,"patch":{"dueDate":date}}),
        );
        assert!(execute(&mut c, "update_task", invalid, "user")
            .unwrap_err()
            .contains("INVALID_INPUT"));
        assert_eq!(serde_json::to_value(load(&c).unwrap()).unwrap(), before);
    }
    let clear = call(
        &mut c,
        "update_task",
        json!({"taskId":initial["task"]["id"],"expectedRevision":2,"patch":{"dueDate":null}}),
    );
    assert!(clear["task"]["dueDate"].is_null());
    assert_eq!(load(&c).unwrap().planning.day_items[0].date, "2030-03-04");
}

#[test]
fn continue_reuses_existing_target_and_retry_preserves_history() {
    let mut c = open(Path::new(":memory:")).unwrap();
    let original = save(&mut c, "2030-03-02");
    let mut input = item_request(&original);
    input["date"] = json!("2030-03-04");
    let input = request(input);
    let (first, changed) = execute(&mut c, "continue_plan_items", input.clone(), "user").unwrap();
    assert!(changed);
    let after = serde_json::to_value(load(&c).unwrap()).unwrap();
    assert_eq!(after["tasks"].as_array().unwrap().len(), 1);
    assert_eq!(after["planning"]["steps"].as_array().unwrap().len(), 1);
    assert_eq!(after["planning"]["dayItems"].as_array().unwrap().len(), 2);
    assert_eq!(after["planning"]["dayItems"][0]["date"], "2030-03-02");
    assert_eq!(
        after["planning"]["dayItems"][0]["continuedTo"],
        first["item"]["id"]
    );
    assert_eq!(
        after["planning"]["planChanges"].as_array().unwrap().len(),
        3
    );
    let (retry, changed) = execute(&mut c, "continue_plan_items", input, "user").unwrap();
    assert!(!changed);
    assert_eq!(retry, first);
    assert_eq!(serde_json::to_value(load(&c).unwrap()).unwrap(), after);
    let older = call(
        &mut c,
        "workbench_save_step",
        json!({"taskId":original["task"]["id"],"stepId":original["step"]["id"],"expectedTaskRevision":1,"expectedStepRevision":1,"title":"合成计划","text":"画草图","category":"work","plannedSeconds":900,"date":"2030-03-01"}),
    );
    let mut again = item_request(&older);
    again["date"] = json!("2030-03-04");
    let reused = call(&mut c, "continue_plan_items", again);
    assert_eq!(reused["item"]["id"], first["item"]["id"]);
    assert_eq!(load(&c).unwrap().planning.day_items.len(), 3);
}

#[test]
fn cancellation_checks_complete_unexecuted_set_and_keeps_executed_source() {
    let mut c = open(Path::new(":memory:")).unwrap();
    let old = save(&mut c, "2030-03-01");
    let mut go = item_request(&old);
    go["date"] = json!("2030-03-04");
    let today = call(&mut c, "continue_plan_items", go);
    let session = call(
        &mut c,
        "start_session",
        json!({"taskId":old["task"]["id"],"expectedRevision":1,"stepId":old["step"]["id"],"expectedStepRevision":1,"dayItemId":old["item"]["id"],"kind":"focus","plannedSeconds":900}),
    );
    let mut cancellation = item_request(&old);
    cancellation["scope"] = json!("unexecuted");
    cancellation["items"] =
        json!([{"id":old["item"]["id"],"revision":2},{"id":today["item"]["id"],"revision":1}]);
    let before = serde_json::to_value(load(&c).unwrap()).unwrap();
    assert!(execute(
        &mut c,
        "cancel_plan_items",
        request(cancellation.clone()),
        "user"
    )
    .unwrap_err()
    .contains("CONFLICT"));
    assert_eq!(serde_json::to_value(load(&c).unwrap()).unwrap(), before);
    cancellation["items"] = json!([{"id":today["item"]["id"],"revision":1}]);
    let out = call(&mut c, "cancel_plan_items", cancellation);
    assert_eq!(out["remainingActiveCount"], 1);
    let state = load(&c).unwrap();
    assert_eq!(state.planning.session_links[0].plan_date, "2030-03-01");
    assert_eq!(json!(state.sessions[0]), session["session"]);
}

#[test]
fn prepared_source_persists_without_clock_and_active_clock_rejects_replacement() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("paper.sqlite");
    let mut c = open(&path).unwrap();
    let out = save(&mut c, "2030-03-06");
    let input = json!({"taskId":out["task"]["id"],"stepId":out["step"]["id"],"expectedRevision":1,"expectedStepRevision":1,"dayItemId":out["item"]["id"]});
    call(&mut c, "prepare_step", input.clone());
    assert!(load(&c).unwrap().sessions.is_empty());
    drop(c);
    let mut c = open(&path).unwrap();
    assert_eq!(
        json!(load(&c).unwrap().planning.prepared.unwrap())["dayItemId"],
        out["item"]["id"]
    );
    call(
        &mut c,
        "start_session",
        json!({"taskId":out["task"]["id"],"expectedRevision":1,"stepId":out["step"]["id"],"expectedStepRevision":1,"dayItemId":out["item"]["id"],"kind":"focus","plannedSeconds":900}),
    );
    let before = serde_json::to_value(load(&c).unwrap()).unwrap();
    assert!(execute(&mut c, "prepare_step", request(input), "user")
        .unwrap_err()
        .contains("ACTIVE_SESSION"));
    assert_eq!(serde_json::to_value(load(&c).unwrap()).unwrap(), before);
    let record = execute(
        &mut c,
        "get_daily_record",
        json!({"date":"2030-03-06","utcOffsetMinutes":480}),
        "user",
    )
    .unwrap()
    .0;
    assert_eq!(record["planChanges"].as_array().unwrap().len(), 1);
    assert!(std::fs::read_to_string(dir.path().join("工作记录/任务.md"))
        .unwrap()
        .contains("截止日期：2030-03-08"));
}
