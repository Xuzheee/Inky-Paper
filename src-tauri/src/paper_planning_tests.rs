use super::*;
use crate::paper;
use rusqlite::Connection;

fn db() -> Connection {
    paper::open(std::path::Path::new(":memory:")).unwrap()
}
fn call(c: &mut Connection, operation: &str, mut input: Value) -> Result<Value, String> {
    if !matches!(
        operation,
        "get_state" | "get_plan_batch" | "get_daily_record" | "get_task"
    ) && input.get("requestId").is_none()
    {
        input["requestId"] = json!(id());
    }
    // Proposals/read tools are model operations; adoption and edits are user clicks.
    let source = if crate::paper_permissions::model_action(operation) { "hermes" } else { "user" };
    paper::execute(c, operation, input, source).map(|x| x.0)
}
fn batch(c: &mut Connection) -> Value {
    let tid = id();
    call(c,"propose_plan_batch",json!({"batchId":id(),"cards":[
        {"id":id(),"taskId":tid,"taskTitle":"项目周报","text":"列出结论","expectedResult":"三个结论","plannedSeconds":1500},
        {"id":id(),"taskId":tid,"taskTitle":"项目周报","text":"核对证据","plannedSeconds":1200},
        {"id":id(),"taskId":tid,"taskTitle":"项目周报","text":"整理初稿"}
    ]})).unwrap()["batch"].clone()
}
fn adopt_input(batch: &Value, count: usize, date: &str) -> Value {
    json!({"requestId":id(),"batchId":batch["id"],"expectedRevision":batch["revision"],"date":date,"cardIds":batch["cards"].as_array().unwrap().iter().take(count).map(|x| x["id"].clone()).collect::<Vec<_>>()})
}
fn state(c: &mut Connection) -> PaperState {
    serde_json::from_value(call(c, "get_state", json!({})).unwrap()["state"].clone()).unwrap()
}
fn session(start: i64) -> Session {
    serde_json::from_value(json!({"id":id(),"taskId":null,"taskTitle":"临时工作","action":null,"taskRevision":null,"kind":"focus","status":"running","revision":1,"plannedSeconds":7200,"elapsedSeconds":0,"startedAt":start,"lastResumedAt":start,"endedAt":null,"pauseCount":0,"resumeCue":null,"feedback":null})).unwrap()
}

fn step_completion_input(s: &PaperState, index: usize, completed: bool) -> Value {
    let step = &s.planning.steps[index];
    let task = s.tasks.iter().find(|task| task.id == step.task_id).unwrap();
    json!({"requestId":id(),"taskId":task.id,"stepId":step.id,"expectedTaskRevision":task.revision,"expectedStepRevision":step.revision,"completed":completed})
}

fn persist_fixture(c: &Connection, s: &PaperState) {
    c.execute(
        "UPDATE paper_state SET data=?1 WHERE id=1",
        [serde_json::to_string(s).unwrap()],
    )
    .unwrap();
}

#[test]
fn manual_step_completion_and_undo_sync_current_action_once_without_completing_parent() {
    let mut c = db();
    let b = batch(&mut c);
    call(&mut c, "adopt_plan_cards", adopt_input(&b, 2, "2026-09-13")).unwrap();
    let before = state(&mut c);
    let input = step_completion_input(&before, 0, true);
    let (first, changed) =
        paper::execute(&mut c, "set_step_completed", input.clone(), "user").unwrap();
    assert!(changed);
    let (retry, changed) =
        paper::execute(&mut c, "set_step_completed", input.clone(), "user").unwrap();
    assert!(!changed);
    assert_eq!(first, retry);
    let after = state(&mut c);
    assert!(after.planning.steps[0].completed);
    assert!(!after.planning.steps[1].completed);
    assert_eq!(
        after.planning.steps[0].revision,
        before.planning.steps[0].revision + 1
    );
    assert!(after.tasks[0].next_action.as_ref().unwrap().completed);
    assert_eq!(after.tasks[0].revision, before.tasks[0].revision + 1);
    assert!(!after.tasks[0].completed);
    assert!(after.tasks[0].completed_at.is_none());
    assert!(after.sessions.is_empty());
    assert!(after.planning.intervals.is_empty());
    assert_eq!(after.planning.manual_step_changes.len(), 1);
    let event_count: i64 = c.query_row(
        "SELECT COUNT(*) FROM paper_events WHERE json_extract(data,'$.kind')='set_step_completed'",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(event_count, 1);
    let same = call(
        &mut c,
        "set_step_completed",
        step_completion_input(&after, 0, true),
    )
    .unwrap();
    assert_eq!(same["task"], first["task"]);
    assert_eq!(same["step"], first["step"]);
    assert!(same["manualStepChange"].is_null());
    assert_eq!(state(&mut c).planning.manual_step_changes.len(), 1);

    let mut reused = input;
    reused["completed"] = json!(false);
    assert!(call(&mut c, "set_step_completed", reused)
        .unwrap_err()
        .contains("REQUEST_ID_REUSED"));
    let restored = call(
        &mut c,
        "set_step_completed",
        step_completion_input(&after, 0, false),
    )
    .unwrap();
    assert_eq!(restored["task"]["completed"], false);
    assert_eq!(restored["task"]["nextAction"]["completed"], false);
    assert_eq!(restored["step"]["completed"], false);
    let final_state = state(&mut c);
    assert_eq!(final_state.planning.manual_step_changes.len(), 2);
    assert!(final_state.planning.manual_step_changes[0].completed);
    assert!(!final_state.planning.manual_step_changes[1].completed);
}

#[test]
fn manual_completion_of_noncurrent_step_preserves_parent_and_historical_clock_snapshot() {
    let mut c = db();
    let b = batch(&mut c);
    call(&mut c, "adopt_plan_cards", adopt_input(&b, 2, "2026-09-13")).unwrap();
    let mut before = state(&mut c);
    // Even a completed parent remains independent when a child is corrected.
    before.tasks[0].completed = true;
    before.tasks[0].completed_at = Some(1);
    let mut old = session(1);
    old.status = "finished".into();
    old.task_id = Some(before.tasks[0].id.clone());
    old.action = Some(action(&before.planning.steps[1]));
    old.elapsed_seconds = 321;
    old.last_resumed_at = None;
    old.ended_at = Some(321_001);
    before.sessions.push(old);
    persist_fixture(&c, &before);
    let result = call(
        &mut c,
        "set_step_completed",
        step_completion_input(&before, 1, true),
    )
    .unwrap();
    assert_eq!(result["task"], json!(before.tasks[0]));
    let after = state(&mut c);
    assert_eq!(json!(after.sessions), json!(before.sessions));
    assert_eq!(
        json!(after.planning.intervals),
        json!(before.planning.intervals)
    );
    assert_eq!(
        after.planning.steps[1].revision,
        before.planning.steps[1].revision + 1
    );
    assert_eq!(
        json!(after.planning.steps[0]),
        json!(before.planning.steps[0])
    );
    let undo = call(
        &mut c,
        "set_step_completed",
        step_completion_input(&after, 1, false),
    )
    .unwrap();
    assert_eq!(undo["task"], json!(before.tasks[0]));
    assert_eq!(json!(state(&mut c).sessions), json!(before.sessions));
}

#[test]
fn manual_step_completion_rejects_remote_sources_bad_versions_and_inputs_atomically() {
    let mut c = db();
    let b = batch(&mut c);
    call(&mut c, "adopt_plan_cards", adopt_input(&b, 2, "2026-09-13")).unwrap();
    call(
        &mut c,
        "create_task",
        json!({"taskId":id(),"title":"另一个任务"}),
    )
    .unwrap();
    let before = state(&mut c);
    let input = step_completion_input(&before, 0, true);
    let counts = || {
        c.query_row(
            "SELECT (SELECT COUNT(*) FROM paper_events),(SELECT COUNT(*) FROM paper_requests)",
            [],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        )
        .unwrap()
    };
    let before_counts = counts();
    for source in ["hermes", "system", "agent"] {
        assert!(
            paper::execute(&mut c, "set_step_completed", input.clone(), source)
                .unwrap_err()
                .starts_with("FORBIDDEN")
        );
    }
    let mut mismatched = input.clone();
    let other_task = before
        .tasks
        .iter()
        .find(|task| task.id != before.planning.steps[0].task_id)
        .unwrap();
    mismatched["taskId"] = json!(other_task.id);
    mismatched["expectedTaskRevision"] = json!(other_task.revision);
    assert!(call(&mut c, "set_step_completed", mismatched)
        .unwrap_err()
        .starts_with("NOT_FOUND: step"));
    for (field, value, error) in [
        ("expectedTaskRevision", json!(999), "CONFLICT"),
        ("expectedStepRevision", json!(999), "CONFLICT"),
        ("stepId", json!(id()), "NOT_FOUND"),
        ("taskId", json!(id()), "NOT_FOUND"),
        ("completed", json!("true"), "INVALID_INPUT"),
        ("completed", Value::Null, "INVALID_INPUT"),
        ("unexpected", json!(true), "INVALID_INPUT"),
    ] {
        let mut invalid = input.clone();
        invalid[field] = value;
        assert!(
            call(&mut c, "set_step_completed", invalid)
                .unwrap_err()
                .starts_with(error),
            "{field}"
        );
    }
    assert_eq!(json!(paper::load(&c).unwrap()), json!(before));
    let after_counts = c
        .query_row(
            "SELECT (SELECT COUNT(*) FROM paper_events),(SELECT COUNT(*) FROM paper_requests)",
            [],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        )
        .unwrap();
    assert_eq!(after_counts, before_counts);
}

#[test]
fn manual_step_completion_locks_only_the_target_task_for_each_active_clock_status() {
    for status in ["running", "paused", "waiting"] {
        let mut c = db();
        let b = batch(&mut c);
        call(&mut c, "adopt_plan_cards", adopt_input(&b, 2, "2026-09-13")).unwrap();
        let other = batch(&mut c);
        call(
            &mut c,
            "adopt_plan_cards",
            adopt_input(&other, 1, "2026-09-13"),
        )
        .unwrap();
        let mut before = state(&mut c);
        let mut clock = session(chrono::Utc::now().timestamp_millis());
        clock.task_id = Some(before.tasks[0].id.clone());
        clock.action = Some(action(&before.planning.steps[0]));
        clock.status = status.into();
        if status != "running" {
            clock.last_resumed_at = None;
        }
        before.sessions.push(clock);
        persist_fixture(&c, &before);
        assert!(call(
            &mut c,
            "set_step_completed",
            step_completion_input(&before, 1, true)
        )
        .unwrap_err()
        .starts_with("ACTIVE_SESSION"));
        assert_eq!(json!(paper::load(&c).unwrap()), json!(before));
        let unrelated = call(
            &mut c,
            "set_step_completed",
            step_completion_input(&before, 2, true),
        )
        .unwrap();
        assert_eq!(unrelated["step"]["completed"], true);
        assert_eq!(json!(state(&mut c).sessions), json!(before.sessions));
    }
}

#[test]
fn manual_completion_imports_legacy_steps_and_invalidates_daily_summary_without_a_plan_or_clock() {
    let mut c = db();
    call(
        &mut c,
        "create_task",
        json!({"taskId":id(),"title":"临时事项","nextAction":"寄出材料"}),
    )
    .unwrap();
    let mut legacy = paper::load(&c).unwrap();
    legacy.planning.steps.clear();
    persist_fixture(&c, &legacy);
    let imported = state(&mut c);
    assert_eq!(imported.planning.steps.len(), 1);
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let before = call(&mut c, "get_daily_record", json!({"date":date})).unwrap();
    call(&mut c, "save_daily_summary", json!({"date":date,"expectedDataVersion":before["dataVersion"],"expectedNotesVersion":before["notesVersion"],"sourceAsOf":before["sampledAt"],"body":"尚无完成事实","evidenceRefs":[]})).unwrap();
    call(
        &mut c,
        "set_step_completed",
        step_completion_input(&imported, 0, true),
    )
    .unwrap();
    let after = call(&mut c, "get_daily_record", json!({"date":date})).unwrap();
    assert_ne!(before["dataVersion"], after["dataVersion"]);
    assert_eq!(after["summaries"][0]["hasNewRecords"], true);
    assert!(after["planItems"].as_array().unwrap().is_empty());
    assert!(after["sessions"].as_array().unwrap().is_empty());
    assert_eq!(after["manualStepChanges"][0]["taskTitle"], "临时事项");
    assert_eq!(after["manualStepChanges"][0]["stepText"], "寄出材料");
    assert_eq!(after["manualStepChanges"][0]["completed"], true);
    let current = state(&mut c);
    call(
        &mut c,
        "set_step_completed",
        step_completion_input(&current, 0, false),
    )
    .unwrap();
    let undone = call(&mut c, "get_daily_record", json!({"date":date})).unwrap();
    assert_ne!(after["dataVersion"], undone["dataVersion"]);
    assert_eq!(undone["manualStepChanges"].as_array().unwrap().len(), 2);
    assert_eq!(undone["manualStepChanges"][1]["completed"], false);
}

#[test]
fn manual_step_facts_keep_snapshots_and_belong_to_the_operation_day_at_the_requested_offset() {
    let mut c = db();
    call(
        &mut c,
        "create_task",
        json!({"taskId":id(),"title":"原任务","nextAction":"原步骤"}),
    )
    .unwrap();
    let mut s = state(&mut c);
    let (midnight, _) = date_bounds("2026-09-14", 480).unwrap();
    let input = step_completion_input(&s, 0, true);
    execute(&mut s, "set_step_completed", &input, "user", midnight - 1).unwrap();
    let input = step_completion_input(&s, 0, false);
    execute(&mut s, "set_step_completed", &input, "user", midnight).unwrap();
    s.tasks[0].title = "后来的标题".into();
    s.planning.steps[0].text = "后来的步骤文字".into();
    let before = daily_record(&s, "2026-09-13", 480, midnight + 1).unwrap();
    let after = daily_record(&s, "2026-09-14", 480, midnight + 1).unwrap();
    assert_eq!(before["manualStepChanges"].as_array().unwrap().len(), 1);
    assert_eq!(before["manualStepChanges"][0]["completed"], true);
    assert_eq!(after["manualStepChanges"].as_array().unwrap().len(), 1);
    assert_eq!(after["manualStepChanges"][0]["completed"], false);
    assert_eq!(after["manualStepChanges"][0]["taskTitle"], "原任务");
    assert_eq!(after["manualStepChanges"][0]["stepText"], "原步骤");
    assert!(after["sessions"].as_array().unwrap().is_empty());
}

#[test]
fn candidates_are_separate_and_selected_cards_save_atomically_without_a_clock() {
    let mut c = db();
    let b = batch(&mut c);
    assert!(state(&mut c).tasks.is_empty());
    let input = adopt_input(&b, 2, "2026-09-13");
    let first = call(&mut c, "adopt_plan_cards", input.clone()).unwrap();
    let again = call(&mut c, "adopt_plan_cards", input).unwrap();
    assert_eq!(first, again);
    let s = state(&mut c);
    assert_eq!(s.tasks.len(), 1);
    assert_eq!(s.planning.steps.len(), 2);
    assert_eq!(s.planning.day_items.len(), 2);
    assert!(s.sessions.is_empty());
    assert!(s.planning.batches[0].cards[2].adopted_step_id.is_none());
    assert!(!s.tasks[0].completed);
}

#[test]
fn invalid_selected_override_does_not_save_any_card_or_event() {
    let mut c = db();
    let b = batch(&mut c);
    let before: i64 = c
        .query_row("SELECT COUNT(*) FROM paper_events", [], |r| r.get(0))
        .unwrap();
    let mut input = adopt_input(&b, 2, "2026-09-13");
    input["cardOverrides"] = json!([{ "cardId":b["cards"][1]["id"], "plannedSeconds":0 }]);
    assert!(call(&mut c, "adopt_plan_cards", input)
        .unwrap_err()
        .contains("INVALID_INPUT"));
    let s = state(&mut c);
    assert!(s.tasks.is_empty());
    assert!(s.planning.steps.is_empty());
    assert!(s.planning.day_items.is_empty());
    assert_eq!(s.planning.batches[0].revision, 1);
    let after: i64 = c
        .query_row("SELECT COUNT(*) FROM paper_events", [], |r| r.get(0))
        .unwrap();
    assert_eq!(before, after);
}

#[test]
fn overrides_for_unselected_cards_and_reused_request_ids_are_rejected() {
    let mut c = db();
    let b = batch(&mut c);
    let mut input = adopt_input(&b, 1, "2026-09-13");
    input["cardOverrides"] = json!([{ "cardId":b["cards"][2]["id"], "text":"不能偷偷采用" }]);
    assert!(call(&mut c, "adopt_plan_cards", input).is_err());
    let input = adopt_input(&b, 1, "2026-09-13");
    call(&mut c, "adopt_plan_cards", input.clone()).unwrap();
    let mut changed = input;
    changed["date"] = json!("2026-09-14");
    assert!(call(&mut c, "adopt_plan_cards", changed)
        .unwrap_err()
        .contains("REQUEST_ID_REUSED"));
}

#[test]
fn adopted_step_is_reused_across_days_and_removed_item_can_be_readded() {
    let mut c = db();
    let b = batch(&mut c);
    let first = call(&mut c, "adopt_plan_cards", adopt_input(&b, 1, "2026-09-13")).unwrap();
    let second = call(
        &mut c,
        "adopt_plan_cards",
        adopt_input(&first["batch"], 1, "2026-09-14"),
    )
    .unwrap();
    assert_eq!(
        first["mappings"][0]["stepId"],
        second["mappings"][0]["stepId"]
    );
    let item = &first["items"][0];
    call(
        &mut c,
        "remove_plan_item",
        json!({"planItemId":item["id"],"expectedRevision":item["revision"]}),
    )
    .unwrap();
    let third = call(
        &mut c,
        "adopt_plan_cards",
        adopt_input(&second["batch"], 1, "2026-09-13"),
    )
    .unwrap();
    assert_eq!(first["items"][0]["id"], third["items"][0]["id"]);
    let s = state(&mut c);
    assert_eq!(s.tasks.len(), 1);
    assert_eq!(s.planning.steps.len(), 1);
    assert_eq!(s.planning.day_items.len(), 2);
}

#[test]
fn stale_task_keeps_candidates_and_requires_reviewed_revision() {
    let mut c = db();
    let b = batch(&mut c);
    let adopted = call(&mut c, "adopt_plan_cards", adopt_input(&b, 1, "2026-09-13")).unwrap();
    let original = state(&mut c).tasks[0].clone();
    let changed = call(&mut c,"update_task",json!({"taskId":original.id,"expectedRevision":original.revision,"patch":{"title":"更新的周报标题"}})).unwrap();
    let mut input = adopt_input(&adopted["batch"], 1, "2026-09-14");
    assert!(call(&mut c, "adopt_plan_cards", input.clone())
        .unwrap_err()
        .contains("CONFLICT"));
    assert_eq!(state(&mut c).planning.day_items.len(), 1);
    input["cardOverrides"] = json!([{ "cardId":b["cards"][0]["id"], "expectedTaskRevision":changed["task"]["revision"] }]);
    call(&mut c, "adopt_plan_cards", input).unwrap();
    assert_eq!(state(&mut c).planning.day_items.len(), 2);
}

#[test]
fn completing_old_session_marks_only_its_step_and_preserves_selected_next_step() {
    let mut c = db();
    let b = batch(&mut c);
    call(&mut c, "adopt_plan_cards", adopt_input(&b, 2, "2026-09-13")).unwrap();
    let s = state(&mut c);
    let task = &s.tasks[0];
    let current = call(&mut c,"start_session",json!({"taskId":task.id,"expectedRevision":task.revision,"plannedSeconds":1500,"kind":"focus","stepId":s.planning.steps[0].id,"expectedStepRevision":1,"dayItemId":s.planning.day_items[0].id})).unwrap()["session"].clone();
    let selected = call(&mut c,"select_step",json!({"taskId":task.id,"stepId":s.planning.steps[1].id,"expectedRevision":task.revision,"expectedStepRevision":1})).unwrap();
    assert_eq!(
        selected["task"]["nextAction"]["id"],
        json!(s.planning.steps[1].id)
    );
    call(&mut c,"finish_session",json!({"sessionId":current["id"],"expectedRevision":current["revision"],"outcome":"step_completed","output":"三个结论"})).unwrap();
    let after = state(&mut c);
    assert!(after.planning.steps[0].completed);
    assert!(!after.planning.steps[1].completed);
    assert!(!after.tasks[0].completed);
    assert_eq!(after.sessions[0].action.as_ref().unwrap().text, "列出结论");
    assert_eq!(
        after.tasks[0].next_action.as_ref().unwrap().id,
        s.planning.steps[1].id
    );
}

#[test]
fn legacy_next_action_changes_preserve_previous_step_identity() {
    let mut c = db();
    let b = batch(&mut c);
    call(&mut c, "adopt_plan_cards", adopt_input(&b, 1, "2026-09-13")).unwrap();
    let task = state(&mut c).tasks[0].clone();
    call(&mut c,"update_task",json!({"taskId":task.id,"expectedRevision":task.revision,"patch":{"nextAction":"新的具体动作"}})).unwrap();
    let s = state(&mut c);
    assert_eq!(s.planning.steps.len(), 2);
    assert_eq!(s.planning.steps[0].text, "列出结论");
    assert_eq!(s.planning.steps[1].text, "新的具体动作");
    assert_ne!(s.planning.steps[0].id, s.planning.steps[1].id);
}

#[test]
fn edited_adopted_card_gets_a_new_step_without_mutating_session_snapshot() {
    let mut c = db();
    let b = batch(&mut c);
    let adopted = call(&mut c, "adopt_plan_cards", adopt_input(&b, 1, "2026-09-13")).unwrap();
    let s = state(&mut c);
    let task = &s.tasks[0];
    let current = call(&mut c,"start_session",json!({"taskId":task.id,"expectedRevision":task.revision,"plannedSeconds":1500,"kind":"focus"})).unwrap()["session"].clone();
    let mut input = adopt_input(&adopted["batch"], 1, "2026-09-14");
    input["cardOverrides"] = json!([{ "cardId":b["cards"][0]["id"], "text":"只先找出一个结论" }]);
    let replacement = call(&mut c, "adopt_plan_cards", input).unwrap();
    assert_ne!(
        adopted["mappings"][0]["stepId"],
        replacement["mappings"][0]["stepId"]
    );
    call(&mut c,"finish_session",json!({"sessionId":current["id"],"expectedRevision":current["revision"],"outcome":"step_completed"})).unwrap();
    let s = state(&mut c);
    assert!(s.planning.steps[0].completed);
    assert!(!s.planning.steps[1].completed);
    assert_eq!(s.sessions[0].action.as_ref().unwrap().text, "列出结论");
}

#[test]
fn intervals_split_midnight_and_exclude_pause_time() {
    let (midnight, _) = date_bounds("2026-09-14", 480).unwrap();
    let mut s = PaperState::default();
    s.sessions.push(session(midnight - 600_000));
    assert!(reconcile_intervals(&[], &mut s, midnight - 600_000));
    let before = s.sessions.clone();
    s.sessions[0].status = "paused".into();
    s.sessions[0].elapsed_seconds = 1200;
    s.sessions[0].last_resumed_at = None;
    reconcile_intervals(&before, &mut s, midnight + 600_000);
    let before = s.sessions.clone();
    s.sessions[0].status = "running".into();
    s.sessions[0].last_resumed_at = Some(midnight + 1_200_000);
    reconcile_intervals(&before, &mut s, midnight + 1_200_000);
    let before = s.sessions.clone();
    s.sessions[0].status = "finished".into();
    s.sessions[0].elapsed_seconds = 1800;
    s.sessions[0].last_resumed_at = None;
    s.sessions[0].ended_at = Some(midnight + 1_800_000);
    reconcile_intervals(&before, &mut s, midnight + 1_800_000);
    let yesterday = daily_record(&s, "2026-09-13", 480, midnight + 1_800_000).unwrap();
    let today = daily_record(&s, "2026-09-14", 480, midnight + 1_800_000).unwrap();
    assert_eq!(yesterday["sessions"][0]["dailySeconds"], 600);
    assert_eq!(today["sessions"][0]["dailySeconds"], 1200);
    assert_eq!(today["sessions"][0]["timePrecision"], "recorded_intervals");
}

#[test]
fn legacy_sessions_report_limited_daily_precision_without_double_counting() {
    let (midnight, _) = date_bounds("2026-09-14", 480).unwrap();
    let mut s = PaperState::default();
    let mut legacy = session(midnight - 600_000);
    legacy.status = "finished".into();
    legacy.elapsed_seconds = 1200;
    legacy.last_resumed_at = None;
    legacy.ended_at = Some(midnight + 600_000);
    s.sessions.push(legacy);
    let before = daily_record(&s, "2026-09-13", 480, midnight + 600_000).unwrap();
    let after = daily_record(&s, "2026-09-14", 480, midnight + 600_000).unwrap();
    assert_eq!(before["sessions"][0]["dailySeconds"], 1200);
    assert_eq!(after["sessions"][0]["dailySeconds"], 0);
    assert_eq!(after["sessions"][0]["timePrecision"], "legacy_start_date");
}

#[test]
fn daily_summary_is_versioned_without_invalidating_itself_or_creating_plans() {
    let mut c = db();
    let before = call(
        &mut c,
        "get_daily_record",
        json!({"date":"2026-09-13","utcOffsetMinutes":480}),
    )
    .unwrap();
    let input = json!({"date":"2026-09-13","utcOffsetMinutes":480,"expectedDataVersion":before["dataVersion"],"expectedNotesVersion":before["notesVersion"],"sourceAsOf":before["sampledAt"],"body":"今日没有已保存的工作记录。","evidenceRefs":[]});
    call(&mut c, "save_daily_summary", input.clone()).unwrap();
    let after = call(
        &mut c,
        "get_daily_record",
        json!({"date":"2026-09-13","utcOffsetMinutes":480}),
    )
    .unwrap();
    assert_eq!(before["dataVersion"], after["dataVersion"]);
    assert_eq!(after["summaries"][0]["hasNewRecords"], false);
    assert!(state(&mut c).tasks.is_empty());
    let b = batch(&mut c);
    call(&mut c, "adopt_plan_cards", adopt_input(&b, 1, "2026-09-13")).unwrap();
    assert!(call(&mut c, "save_daily_summary", input)
        .unwrap_err()
        .contains("CONFLICT"));
    let changed = call(
        &mut c,
        "get_daily_record",
        json!({"date":"2026-09-13","utcOffsetMinutes":480}),
    )
    .unwrap();
    assert_eq!(changed["summaries"][0]["hasNewRecords"], true);
    assert_eq!(changed["summaries"].as_array().unwrap().len(), 1);
}

#[test]
fn invalid_date_stale_step_and_mismatched_daily_item_are_rejected() {
    let mut c = db();
    assert!(call(&mut c, "get_daily_record", json!({"date":"2026-02-30"})).is_err());
    let b = batch(&mut c);
    call(&mut c, "adopt_plan_cards", adopt_input(&b, 2, "2026-09-13")).unwrap();
    let s = state(&mut c);
    let mut input = json!({"taskId":s.tasks[0].id,"expectedRevision":s.tasks[0].revision,"plannedSeconds":1500,"kind":"focus","stepId":s.planning.steps[0].id,"expectedStepRevision":99});
    assert!(call(&mut c, "start_session", input.clone())
        .unwrap_err()
        .contains("CONFLICT"));
    input["expectedStepRevision"] = json!(1);
    input["dayItemId"] = json!(s.planning.day_items[1].id);
    assert!(call(&mut c, "start_session", input)
        .unwrap_err()
        .contains("INVALID_INPUT"));
    assert!(state(&mut c).sessions.is_empty());
}

#[test]
fn work_start_clock_links_to_today_card_and_explicit_prior_day_link_wins() {
    let mut c = db();
    let b = batch(&mut c);
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let adopted = call(&mut c, "adopt_plan_cards", adopt_input(&b, 1, &today)).unwrap();
    let s = state(&mut c);
    call(&mut c,"start_work",json!({"taskId":s.tasks[0].id,"expectedRevision":s.tasks[0].revision,"plannedEndAt":chrono::Utc::now().timestamp_millis()+3_600_000,"plannedSeconds":1200})).unwrap();
    let s = state(&mut c);
    assert_eq!(s.planning.session_links.len(), 1);
    assert_eq!(s.planning.session_links[0].session_id, s.sessions[0].id);
    assert_eq!(
        s.planning.session_links[0].day_item_id,
        adopted["items"][0]["id"].as_str().unwrap()
    );
    assert_eq!(s.planning.session_links[0].plan_date, today);

    let mut direct = PaperState::default();
    direct.tasks = s.tasks.clone();
    direct.planning.day_items = s.planning.day_items.clone();
    let mut prior_item = direct.planning.day_items[0].clone();
    prior_item.id = id();
    prior_item.date = "2026-01-01".into();
    direct.planning.day_items.push(prior_item.clone());
    let mut current = session(chrono::Utc::now().timestamp_millis());
    current.task_id = Some(s.tasks[0].id.clone());
    current.action = s.tasks[0].next_action.clone();
    direct.sessions.push(current.clone());
    link_session(&mut direct, &current, &json!({"dayItemId":prior_item.id}));
    reconcile_intervals(&[], &mut direct, current.started_at);
    assert_eq!(direct.planning.session_links.len(), 1);
    assert_eq!(direct.planning.session_links[0].plan_date, "2026-01-01");
}

#[test]
fn millisecond_midnight_boundary_keeps_daily_seconds_equal_to_clock_total() {
    let (midnight, _) = date_bounds("2026-09-14", 480).unwrap();
    let mut s = PaperState::default();
    s.sessions.push(session(midnight - 500));
    reconcile_intervals(&[], &mut s, midnight - 500);
    let before = s.sessions.clone();
    s.sessions[0].status = "finished".into();
    s.sessions[0].elapsed_seconds = 1;
    s.sessions[0].last_resumed_at = None;
    s.sessions[0].ended_at = Some(midnight + 500);
    reconcile_intervals(&before, &mut s, midnight + 500);
    let day1 = daily_record(&s, "2026-09-13", 480, midnight + 500).unwrap();
    let day2 = daily_record(&s, "2026-09-14", 480, midnight + 500).unwrap();
    assert_eq!(day1["sessions"][0]["dailyMilliseconds"], 500);
    assert_eq!(day2["sessions"][0]["dailyMilliseconds"], 500);
    assert_eq!(
        day1["sessions"][0]["dailySeconds"].as_u64().unwrap()
            + day2["sessions"][0]["dailySeconds"].as_u64().unwrap(),
        1
    );
}

#[test]
fn runtime_emits_one_compact_event_for_expiry_and_legacy_step_import() {
    let mut c = db();
    let b = batch(&mut c);
    call(&mut c, "adopt_plan_cards", adopt_input(&b, 1, "2026-09-13")).unwrap();
    let s = state(&mut c);
    call(&mut c,"start_work",json!({"taskId":s.tasks[0].id,"expectedRevision":s.tasks[0].revision,"plannedEndAt":chrono::Utc::now().timestamp_millis()+3_600_000,"plannedSeconds":0})).unwrap();
    let mut s = state(&mut c);
    s.planning.steps.clear();
    s.coach.blocks[0].planned_end_at = chrono::Utc::now().timestamp_millis() - 1000;
    c.execute(
        "UPDATE paper_state SET data=?1 WHERE id=1",
        [serde_json::to_string(&s).unwrap()],
    )
    .unwrap();
    paper::runtime_tick(&mut c, || None).unwrap();
    paper::runtime_tick(&mut c, || None).unwrap();
    for kind in ["planning_steps_reconciled", "work_blocks_expired"] {
        let count: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM paper_events WHERE json_extract(data,'$.kind')=?1",
                [kind],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let event: String = c
            .query_row(
                "SELECT data FROM paper_events WHERE json_extract(data,'$.kind')=?1",
                [kind],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!event.contains("项目周报"));
        assert!(event.len() < 500);
    }
}
