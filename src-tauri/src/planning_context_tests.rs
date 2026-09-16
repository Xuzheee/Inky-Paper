use super::*;
use crate::paper::Task;
use crate::paper_planning::{DayItem, Step};

const DATE: &str = "2030-03-04";
const OTHER_DATE: &str = "2030-03-05";

fn task(id: &str) -> Task {
    serde_json::from_value(
        json!({"id":id,"title":"合成任务","due":null,"nextAction":null,"completed":false,
        "revision":1,"source":"user","createdAt":1,"updatedAt":1,"completedAt":null}),
    )
    .unwrap()
}

fn add_item(s: &mut PaperState, id: &str, start: Option<u32>, minutes: Option<u32>) {
    s.tasks.push(task(id));
    s.planning.steps.push(Step {
        id: format!("step-{id}"),
        task_id: id.into(),
        text: "首轮时长不是估计工时".into(),
        expected_result: None,
        planned_seconds: 7200,
        completed: false,
        revision: 1,
        source: "user".into(),
        created_at: 1,
        updated_at: 1,
    });
    s.planning.day_items.push(DayItem {
        id: id.into(),
        date: DATE.into(),
        task_id: id.into(),
        step_id: format!("step-{id}"),
        start_minute: start,
        duration_minutes: minutes,
        ..Default::default()
    });
}

fn input(revision: u64, budget: Value, unavailable: Value) -> Value {
    json!({"date":DATE,"expectedRevision":revision,"availableMinutes":budget,"unavailable":unavailable})
}

fn save(s: &mut PaperState, v: Value) -> Value {
    execute(s, "save_day_constraints", &v, "user", 100).unwrap()
}

fn snapshot(s: &PaperState) -> Value {
    serde_json::to_value(s).unwrap()
}

fn failure(s: &mut PaperState, v: Value, prefix: &str) {
    let before = snapshot(s);
    let error = execute(s, "save_day_constraints", &v, "user", 100).unwrap_err();
    assert!(error.starts_with(prefix), "{error}");
    assert_eq!(snapshot(s), before);
}

#[test]
fn unknown_budget_and_durations_stay_unknown_and_first_round_is_not_effort() {
    let mut s = PaperState::default();
    add_item(&mut s, "unknown", None, None);
    let before = snapshot(&s);
    let result = day_capacity(&s, DATE).unwrap();
    assert_eq!(result["availableMinutes"], Value::Null);
    assert_eq!(result["overBudget"], Value::Null);
    assert_eq!(result["reservedMinutes"], 0);
    assert_eq!(result["unestimatedCount"], 1);
    assert_eq!(result["fullyEstimated"], false);
    assert_eq!(result["calendarOccupiedMinutes"], 0);
    assert_eq!(snapshot(&s), before);
    let read = execute(
        &mut s,
        "get_day_capacity",
        &json!({"date":DATE}),
        "user",
        100,
    )
    .unwrap();
    assert_eq!(read["constraints"], Value::Null);
    assert_eq!(read["capacity"], result);
    assert_eq!(snapshot(&s), before);
}

#[test]
fn effort_sum_is_distinct_from_calendar_union_and_conflicts_report_intersections() {
    let mut s = PaperState::default();
    add_item(&mut s, "a", Some(60), Some(120));
    add_item(&mut s, "b", Some(120), Some(120));
    add_item(&mut s, "c", Some(240), Some(30));
    add_item(&mut s, "flexible", None, Some(45));
    add_item(&mut s, "unknown", None, None);
    let out = save(
        &mut s,
        input(
            0,
            json!(300),
            json!([
                {"startMinute":90,"endMinute":150},{"startMinute":140,"endMinute":180},{"startMinute":260,"endMinute":280}
            ]),
        ),
    );
    let capacity = &out["capacity"];
    assert_eq!(capacity["reservedMinutes"], 315);
    assert_eq!(capacity["calendarOccupiedMinutes"], 210);
    assert_eq!(capacity["unestimatedCount"], 1);
    assert_eq!(capacity["fullyEstimated"], false);
    assert_eq!(capacity["overBudget"], true);
    assert_eq!(
        capacity["overlapPairs"],
        json!([{"first":"a","second":"b"}])
    );
    assert_eq!(
        capacity["unavailableConflicts"],
        json!([
            {"itemId":"a","startMinute":90,"endMinute":180},
            {"itemId":"b","startMinute":120,"endMinute":180},
            {"itemId":"c","startMinute":260,"endMinute":270},
        ])
    );
    s.planning.day_items.reverse();
    assert_eq!(day_capacity(&s, DATE).unwrap(), *capacity);
}

#[test]
fn zero_budget_is_explicit_and_missing_estimates_are_counted_separately() {
    let mut s = PaperState::default();
    add_item(&mut s, "unknown", None, None);
    let saved = save(&mut s, input(0, json!(0), json!([])));
    assert_eq!(saved["constraints"]["availableMinutes"], 0);
    assert_eq!(saved["capacity"]["overBudget"], false);
    assert_eq!(saved["capacity"]["unestimatedCount"], 1);
    add_item(&mut s, "estimate", None, Some(1));
    assert_eq!(day_capacity(&s, DATE).unwrap()["overBudget"], true);
    let saved = save(&mut s, input(1, Value::Null, json!([])));
    assert_eq!(saved["constraints"]["revision"], 2);
    assert_eq!(saved["capacity"]["overBudget"], Value::Null);
}

#[test]
fn completed_removed_wrong_date_and_dangling_items_do_not_count_as_remaining_work() {
    let mut s = PaperState::default();
    for id in [
        "active",
        "parent-done",
        "step-done",
        "removed",
        "other-date",
        "missing-task",
        "missing-step",
        "wrong-pair",
    ] {
        add_item(&mut s, id, Some(60), Some(30));
    }
    s.tasks
        .iter_mut()
        .find(|task| task.id == "parent-done")
        .unwrap()
        .completed = true;
    s.planning
        .steps
        .iter_mut()
        .find(|step| step.task_id == "step-done")
        .unwrap()
        .completed = true;
    s.planning
        .day_items
        .iter_mut()
        .find(|item| item.id == "removed")
        .unwrap()
        .removed_at = Some(10);
    s.planning
        .day_items
        .iter_mut()
        .find(|item| item.id == "other-date")
        .unwrap()
        .date = OTHER_DATE.into();
    s.tasks.retain(|task| task.id != "missing-task");
    s.planning
        .steps
        .retain(|step| step.task_id != "missing-step");
    s.planning
        .steps
        .iter_mut()
        .find(|step| step.task_id == "wrong-pair")
        .unwrap()
        .task_id = "active".into();
    let result = day_capacity(&s, DATE).unwrap();
    assert_eq!(result["reservedMinutes"], 30);
    assert_eq!(result["calendarOccupiedMinutes"], 30);
    assert_eq!(result["unestimatedCount"], 0);
    assert_eq!(result["overlapPairs"], json!([]));
    assert_eq!(s.planning.day_items.len(), 8);
}

#[test]
fn constraints_apply_only_to_the_exact_date_without_assuming_work_hours() {
    let mut s = PaperState::default();
    add_item(&mut s, "today", Some(0), Some(1440));
    let out = save(
        &mut s,
        input(0, json!(1440), json!([{"startMinute":0,"endMinute":1440}])),
    );
    assert_eq!(out["capacity"]["calendarOccupiedMinutes"], 1440);
    assert_eq!(out["capacity"]["overBudget"], false);
    assert_eq!(
        out["capacity"]["unavailableConflicts"],
        json!([{"itemId":"today","startMinute":0,"endMinute":1440}])
    );
    let other = day_capacity(&s, OTHER_DATE).unwrap();
    assert_eq!(other["availableMinutes"], Value::Null);
    assert_eq!(other["overBudget"], Value::Null);
    assert_eq!(other["reservedMinutes"], 0);
    assert_eq!(other["fullyEstimated"], true);
    assert_eq!(other["unavailableConflicts"], json!([]));
}

#[test]
fn touching_intervals_are_not_overlaps_and_nested_intervals_count_union_once() {
    let mut s = PaperState::default();
    add_item(&mut s, "a", Some(0), Some(30));
    add_item(&mut s, "b", Some(30), Some(30));
    add_item(&mut s, "c", Some(10), Some(10));
    let result = day_capacity(&s, DATE).unwrap();
    assert_eq!(result["calendarOccupiedMinutes"], 60);
    assert_eq!(result["reservedMinutes"], 70);
    assert_eq!(result["overlapPairs"], json!([{"first":"a","second":"c"}]));
}

#[test]
fn invalid_ranges_and_budgets_fail_before_any_write() {
    let mut s = PaperState::default();
    for budget in [json!(-1), json!(1441), json!(1.5), json!("60")] {
        failure(&mut s, input(0, budget, json!([])), "INVALID_INPUT:");
    }
    for interval in [
        json!({"startMinute":0,"endMinute":0}),
        json!({"startMinute":60,"endMinute":30}),
        json!({"startMinute":-1,"endMinute":10}),
        json!({"startMinute":0,"endMinute":1441}),
        json!({"startMinute":1.5,"endMinute":10}),
        json!({"startMinute":0,"endMinute":10,"extra":true}),
    ] {
        failure(
            &mut s,
            input(0, json!(60), json!([interval])),
            "INVALID_INPUT:",
        );
    }
    for invalid_date in ["2030-2-01", "2030-02-29", "2030-13-01", "2030-03-04Z", ""] {
        let mut value = input(0, json!(60), json!([]));
        value["date"] = json!(invalid_date);
        failure(&mut s, value, "INVALID_INPUT:");
        assert!(day_capacity(&s, invalid_date).is_err());
    }
    let mut missing = input(0, json!(60), json!([]));
    missing.as_object_mut().unwrap().remove("availableMinutes");
    failure(&mut s, missing, "INVALID_INPUT:");
    let mut missing = input(0, json!(60), json!([]));
    missing.as_object_mut().unwrap().remove("unavailable");
    failure(&mut s, missing, "INVALID_INPUT:");
}

#[test]
fn save_uses_only_its_day_revision_and_clear_preserves_the_versioned_object() {
    let mut s = PaperState::default();
    let mut wrong = input(1, json!(60), json!([]));
    failure(&mut s, wrong.clone(), "CONFLICT:");
    let first = save(
        &mut s,
        input(0, json!(60), json!([{"startMinute":0,"endMinute":60}])),
    );
    assert_eq!(first["constraints"]["revision"], 1);
    assert_eq!(first["constraints"]["source"], "user");
    assert_eq!(first["constraints"]["updatedAt"], 100);
    wrong["expectedRevision"] = json!(0);
    failure(&mut s, wrong, "CONFLICT:");
    add_item(&mut s, "added-after-dialog", None, Some(15));
    let cleared = save(&mut s, input(1, Value::Null, json!([])));
    assert_eq!(cleared["constraints"]["revision"], 2);
    assert_eq!(cleared["constraints"]["availableMinutes"], Value::Null);
    assert_eq!(cleared["constraints"]["unavailable"], json!([]));
    assert_eq!(cleared["capacity"]["reservedMinutes"], 15);
    assert_eq!(s.planning.context.days.len(), 1);
    assert_eq!(s.tasks.len(), 1);
    assert!(s.sessions.is_empty());
}

#[test]
fn invalid_legacy_time_is_not_silently_counted_as_zero_and_failed_save_rolls_back() {
    let mut s = PaperState::default();
    add_item(&mut s, "bad", None, Some(0));
    assert!(day_capacity(&s, DATE)
        .unwrap_err()
        .starts_with("INVALID_STATE:"));
    failure(&mut s, input(0, json!(60), json!([])), "INVALID_STATE:");
    s.planning.day_items[0].duration_minutes = Some(60);
    s.planning.day_items[0].start_minute = Some(1430);
    assert!(day_capacity(&s, DATE).is_err());
    s.planning.day_items[0].duration_minutes = None;
    assert!(day_capacity(&s, DATE).is_err());
}

#[test]
fn non_user_cannot_write_and_old_state_defaults_to_empty_context() {
    let mut s = PaperState::default();
    for source in ["agent", "hermes", "system", ""] {
        let before = snapshot(&s);
        assert!(
            execute(&mut s, "save_day_constraints", &json!({}), source, 100)
                .unwrap_err()
                .starts_with("FORBIDDEN:")
        );
        assert_eq!(snapshot(&s), before);
    }
    let old: PaperState =
        serde_json::from_value(json!({"tasks":[],"sessions":[],"notes":[],"planning":{}})).unwrap();
    assert!(old.planning.context.days.is_empty());
}

#[test]
fn public_named_transaction_retries_once_and_read_has_no_mutation_event() {
    let mut c = crate::paper::open(std::path::Path::new(":memory:")).unwrap();
    let mut v = input(0, json!(45), json!([]));
    v["requestId"] = json!(uuid::Uuid::new_v4().to_string());
    let (first, changed) =
        crate::paper::execute(&mut c, "save_day_constraints", v.clone(), "user").unwrap();
    assert!(changed);
    let (retry, changed) =
        crate::paper::execute(&mut c, "save_day_constraints", v.clone(), "user").unwrap();
    assert!(!changed);
    assert_eq!(retry, first);
    let before = crate::paper::load(&c).unwrap();
    let event_count = c
        .query_row("SELECT COUNT(*) FROM paper_events", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap();
    let (read, changed) =
        crate::paper::execute(&mut c, "get_day_capacity", json!({"date":DATE}), "user").unwrap();
    assert!(!changed);
    assert_eq!(read, first);
    assert_eq!(
        event_count,
        c.query_row("SELECT COUNT(*) FROM paper_events", [], |r| r
            .get::<_, i64>(0))
            .unwrap()
    );
    assert_eq!(
        snapshot(&before),
        snapshot(&crate::paper::load(&c).unwrap())
    );
    v["availableMinutes"] = json!(30);
    assert!(
        crate::paper::execute(&mut c, "save_day_constraints", v, "user")
            .unwrap_err()
            .starts_with("REQUEST_ID_REUSED:")
    );
    assert_eq!(
        snapshot(&before),
        snapshot(&crate::paper::load(&c).unwrap())
    );
}

fn project_input(id: &str, revision: u64) -> Value {
    json!({"projectId":id,"expectedRevision":revision,"title":"合成项目","goal":"","criteria":"",
        "referenceLinks":[],"archived":false})
}

fn project_save(s: &mut PaperState, v: Value) -> Value {
    execute(s, "save_project", &v, "user", 200).unwrap()
}

fn project_failure(s: &mut PaperState, operation: &str, v: Value, prefix: &str) {
    let before = snapshot(s);
    let error = execute(s, operation, &v, "user", 200).unwrap_err();
    assert!(error.starts_with(prefix), "{error}");
    assert_eq!(snapshot(s), before);
}

#[test]
fn projects_default_empty_and_save_explicit_goal_criteria_and_unread_links() {
    let old: PaperState = serde_json::from_value(
        json!({"tasks":[],"sessions":[],"notes":[],"planning":{"context":{"days":[]}}}),
    )
    .unwrap();
    assert!(old.planning.context.projects.is_empty());
    let mut s = old;
    let mut input = project_input("project-one", 0);
    input["title"] = json!("  新产品原型  ");
    input["goal"] = json!("验证最短操作路径");
    input["criteria"] = json!("用户能从笔记回到当前步骤");
    input["referenceLinks"] = json!([
        "https://reference.example.test/path?q=1#section",
        "http://reference.example.test/说明"
    ]);
    let result = project_save(&mut s, input);
    assert_eq!(result["project"]["title"], "新产品原型");
    assert_eq!(result["project"]["goal"], "验证最短操作路径");
    assert_eq!(result["project"]["criteria"], "用户能从笔记回到当前步骤");
    assert_eq!(
        result["project"]["referenceLinks"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(result["project"]["revision"], 1);
    assert_eq!(result["project"]["source"], "user");
    assert_eq!(result["project"]["updatedAt"], 200);
    assert!(result["project"].get("referenceContent").is_none());
    assert!(s.tasks.is_empty());
    assert!(s.sessions.is_empty());
    assert!(s.planning.day_items.is_empty());
}

#[test]
fn project_save_enforces_text_limits_and_http_url_only_without_partial_write() {
    let mut s = PaperState::default();
    for (field, value) in [
        ("title", json!("")),
        ("title", json!("长".repeat(101))),
        ("goal", json!("长".repeat(2001))),
        ("criteria", json!("长".repeat(2001))),
        ("goal", Value::Null),
        ("archived", json!("false")),
    ] {
        let mut v = project_input("project-one", 0);
        v[field] = value;
        project_failure(&mut s, "save_project", v, "INVALID_INPUT:");
    }
    for invalid in [
        "javascript:alert(1)",
        "file:///C:/Users/private.txt",
        "ftp://example.test",
        "/relative",
        "",
        "https://",
    ] {
        let mut v = project_input("project-one", 0);
        v["referenceLinks"] = json!([invalid]);
        project_failure(&mut s, "save_project", v, "INVALID_INPUT:");
    }
    let mut v = project_input("project-one", 0);
    v["referenceLinks"] = json!((0..11).map(|_| "https://example.test/").collect::<Vec<_>>());
    project_failure(&mut s, "save_project", v, "INVALID_INPUT:");
    let mut v = project_input("project-one", 0);
    v["referenceLinks"] = json!([false]);
    project_failure(&mut s, "save_project", v, "INVALID_INPUT:");
    let mut v = project_input("project-one", 0);
    v["title"] = json!("字".repeat(100));
    v["goal"] = json!("字".repeat(2000));
    v["criteria"] = json!("字".repeat(2000));
    v["referenceLinks"] = json!((0..10).map(|_| "https://example.test/").collect::<Vec<_>>());
    assert_eq!(project_save(&mut s, v)["project"]["revision"], 1);
}

#[test]
fn project_revision_rejects_stale_save_and_empty_fields_can_be_cleared() {
    let mut s = PaperState::default();
    project_failure(
        &mut s,
        "save_project",
        project_input("project-one", 1),
        "CONFLICT:",
    );
    let mut v = project_input("project-one", 0);
    v["goal"] = json!("原目标");
    v["criteria"] = json!("原标准");
    v["referenceLinks"] = json!(["https://example.test/"]);
    project_save(&mut s, v.clone());
    project_failure(&mut s, "save_project", v, "CONFLICT:");
    let result = project_save(&mut s, project_input("project-one", 1));
    assert_eq!(result["project"]["revision"], 2);
    assert_eq!(result["project"]["goal"], "");
    assert_eq!(result["project"]["criteria"], "");
    assert_eq!(result["project"]["referenceLinks"], json!([]));
    assert_eq!(s.planning.context.projects.len(), 1);
}

#[test]
fn task_project_assignment_checks_both_revisions_and_preserves_category_and_next_action() {
    let mut s = PaperState::default();
    add_item(&mut s, "task-one", Some(30), Some(20));
    s.tasks[0].category = "study".into();
    s.tasks[0].next_action = Some(crate::paper::Action {
        id: "action-one".into(),
        text: "当前一步".into(),
        completed: false,
        source: "user".into(),
    });
    let before_action = serde_json::to_value(&s.tasks[0].next_action).unwrap();
    let before_items = serde_json::to_value(&s.planning.day_items).unwrap();
    project_save(&mut s, project_input("project-one", 0));
    let mut v = json!({"taskId":"task-one","expectedTaskRevision":1,"projectId":"project-one","expectedProjectRevision":1});
    v["expectedTaskRevision"] = json!(0);
    project_failure(&mut s, "set_task_project", v.clone(), "CONFLICT:");
    v["expectedTaskRevision"] = json!(1);
    v["expectedProjectRevision"] = json!(0);
    project_failure(&mut s, "set_task_project", v.clone(), "CONFLICT:");
    v["expectedProjectRevision"] = json!(1);
    let assigned = execute(&mut s, "set_task_project", &v, "user", 300).unwrap();
    assert_eq!(assigned["task"]["projectId"], "project-one");
    assert_eq!(assigned["task"]["category"], "study");
    assert_eq!(assigned["task"]["revision"], 2);
    assert_eq!(assigned["task"]["nextAction"], before_action);
    assert_eq!(
        serde_json::to_value(&s.planning.day_items).unwrap(),
        before_items
    );
    let clear = execute(
        &mut s,
        "set_task_project",
        &json!({"taskId":"task-one","expectedTaskRevision":2,"projectId":null}),
        "user",
        400,
    )
    .unwrap();
    assert_eq!(clear["task"]["projectId"], Value::Null);
    assert_eq!(clear["task"]["revision"], 3);
    assert_eq!(clear["task"]["category"], "study");
    assert_eq!(clear["project"], Value::Null);
    assert_eq!(s.planning.context.projects[0].revision, 1);
}

#[test]
fn archiving_preserves_existing_task_associations_plans_and_execution_snapshots() {
    let mut s = PaperState::default();
    add_item(&mut s, "task-one", Some(30), Some(20));
    project_save(&mut s, project_input("project-one", 0));
    s.tasks[0].project_id = Some("project-one".into());
    let historical = json!({"id":"past-session","taskId":"task-one","taskTitle":"执行当时的任务名",
        "action":{"id":"step-task-one","text":"执行当时的步骤","completed":false,"source":"user"},
        "taskRevision":1,"kind":"focus","status":"finished","revision":2,"plannedSeconds":900,"elapsedSeconds":120,
        "startedAt":1,"lastResumedAt":null,"endedAt":121,"pauseCount":0,"resumeCue":null,"feedback":{"outcome":"stopped"}});
    s.sessions
        .push(serde_json::from_value(historical.clone()).unwrap());
    let before_tasks = serde_json::to_value(&s.tasks).unwrap();
    let before_items = serde_json::to_value(&s.planning.day_items).unwrap();
    let mut archive = project_input("project-one", 1);
    archive["archived"] = json!(true);
    let result = project_save(&mut s, archive);
    assert_eq!(result["project"]["archived"], true);
    assert_eq!(serde_json::to_value(&s.tasks).unwrap(), before_tasks);
    assert_eq!(
        serde_json::to_value(&s.planning.day_items).unwrap(),
        before_items
    );
    assert_eq!(serde_json::to_value(&s.sessions[0]).unwrap(), historical);
    let v = json!({"taskId":"task-one","expectedTaskRevision":1,"projectId":"project-one","expectedProjectRevision":2});
    project_failure(&mut s, "set_task_project", v, "CONFLICT:");
    project_save(&mut s, project_input("project-one", 2));
    assert_eq!(s.tasks[0].project_id.as_deref(), Some("project-one"));
}

#[test]
fn changing_project_during_a_session_preserves_its_snapshot_and_clock() {
    let mut s = PaperState::default();
    add_item(&mut s, "task-one", None, None);
    project_save(&mut s, project_input("project-one", 0));
    s.sessions.push(serde_json::from_value(json!({"id":"running-session","taskId":"task-one","taskTitle":"当时标题",
        "action":null,"taskRevision":1,"kind":"focus","status":"running","revision":1,"plannedSeconds":900,
        "elapsedSeconds":45,"startedAt":1,"lastResumedAt":50,"endedAt":null,"pauseCount":0,"resumeCue":null,"feedback":null})).unwrap());
    let before = serde_json::to_value(&s.sessions).unwrap();
    execute(&mut s,"set_task_project",&json!({"taskId":"task-one","expectedTaskRevision":1,"projectId":"project-one","expectedProjectRevision":1}),"user",300).unwrap();
    assert_eq!(serde_json::to_value(&s.sessions).unwrap(), before);
    assert_eq!(s.tasks[0].project_id.as_deref(), Some("project-one"));
}

#[test]
fn task_project_requires_explicit_null_or_a_real_project_and_user_authority() {
    let mut s = PaperState::default();
    add_item(&mut s, "task-one", None, None);
    for v in [
        json!({"taskId":"task-one","expectedTaskRevision":1}),
        json!({"taskId":"task-one","expectedTaskRevision":1,"projectId":false}),
    ] {
        project_failure(&mut s, "set_task_project", v, "INVALID_INPUT:");
    }
    project_failure(
        &mut s,
        "set_task_project",
        json!({"taskId":"task-one","expectedTaskRevision":1,"projectId":"missing","expectedProjectRevision":1}),
        "NOT_FOUND:",
    );
    let before = snapshot(&s);
    for source in ["agent", "hermes", "system", ""] {
        for operation in ["save_project", "set_task_project"] {
            assert!(execute(&mut s, operation, &json!({}), source, 200)
                .unwrap_err()
                .starts_with("FORBIDDEN:"));
        }
    }
    assert_eq!(snapshot(&s), before);
}

#[test]
fn project_named_transactions_retry_exact_payloads_without_duplicate_events_or_revisions() {
    let mut c = crate::paper::open(std::path::Path::new(":memory:")).unwrap();
    let mut s = PaperState::default();
    add_item(&mut s, "task-one", None, None);
    c.execute(
        "UPDATE paper_state SET data=?1 WHERE id=1",
        [snapshot(&s).to_string()],
    )
    .unwrap();
    let mut v = project_input("project-one", 0);
    v["requestId"] = json!(uuid::Uuid::new_v4().to_string());
    let (first, changed) =
        crate::paper::execute(&mut c, "save_project", v.clone(), "user").unwrap();
    assert!(changed);
    let (retry, changed) =
        crate::paper::execute(&mut c, "save_project", v.clone(), "user").unwrap();
    assert!(!changed);
    assert_eq!(first, retry);
    let link = json!({"taskId":"task-one","expectedTaskRevision":1,"projectId":"project-one","expectedProjectRevision":1,"requestId":uuid::Uuid::new_v4().to_string()});
    let (first, changed) =
        crate::paper::execute(&mut c, "set_task_project", link.clone(), "user").unwrap();
    assert!(changed);
    let (retry, changed) = crate::paper::execute(&mut c, "set_task_project", link, "user").unwrap();
    assert!(!changed);
    assert_eq!(first, retry);
    let state = crate::paper::load(&c).unwrap();
    assert_eq!(state.planning.context.projects.len(), 1);
    assert_eq!(state.planning.context.projects[0].revision, 1);
    assert_eq!(state.tasks[0].revision, 2);
    assert_eq!(c.query_row("SELECT COUNT(*) FROM paper_events WHERE json_extract(data,'$.kind') IN ('save_project','set_task_project')",[],|r|r.get::<_,i64>(0)).unwrap(),2);
    v["title"] = json!("不能使用同一requestId改参数");
    assert!(crate::paper::execute(&mut c, "save_project", v, "user")
        .unwrap_err()
        .starts_with("REQUEST_ID_REUSED:"));
    assert_eq!(snapshot(&crate::paper::load(&c).unwrap()), snapshot(&state));
}

fn preference_input(id: &str, revision: u64, scope: &str) -> Value {
    json!({"preferenceId":id,"expectedRevision":revision,"text":"我希望每轮先做一个小步骤","scope":scope,
        "date":if scope=="day" {Some(DATE)} else {None},
        "projectId":if scope=="project" {Some("project-one")} else {None},"enabled":true})
}

fn preference_save(s: &mut PaperState, input: Value) -> Value {
    execute(s, "save_preference", &input, "user", 300).unwrap()
}

fn active_ids(s: &PaperState, date: &str, projects: &[String]) -> Vec<String> {
    active_preferences(s, date, projects)
        .unwrap()
        .into_iter()
        .map(|preference| preference.id.clone())
        .collect()
}

#[test]
fn preferences_default_empty_and_are_not_inferred_from_notes_or_feedback() {
    let mut old: PaperState = serde_json::from_value(
        json!({"tasks":[],"sessions":[],"notes":[{"id":"n","text":"今天有点累"}],
        "planning":{"context":{"days":[],"projects":[]}}}),
    )
    .unwrap();
    assert!(old.planning.context.preferences.is_empty());
    assert_eq!(old.planning.context.preferences_revision, 0);
    assert!(active_preferences(&old, DATE, &[]).unwrap().is_empty());
    let saved = preference_save(&mut old, preference_input("global-one", 0, "global"));
    assert_eq!(saved["preference"]["confirmedAt"], 300);
    assert_eq!(saved["preference"]["source"], "user");
    assert_eq!(saved["preference"]["revision"], 1);
    assert_eq!(saved["preferencesRevision"], 1);
    assert_eq!(old.notes.len(), 1);
}

#[test]
fn active_preferences_only_include_enabled_current_date_and_related_active_projects() {
    let mut s = PaperState::default();
    project_save(&mut s, project_input("project-one", 0));
    project_save(&mut s, project_input("project-two", 0));
    preference_save(&mut s, preference_input("global-one", 0, "global"));
    preference_save(&mut s, preference_input("day-one", 0, "day"));
    preference_save(&mut s, preference_input("project-one-pref", 0, "project"));
    let mut other = preference_input("other-date", 0, "day");
    other["date"] = json!(OTHER_DATE);
    preference_save(&mut s, other);
    let mut other = preference_input("other-project", 0, "project");
    other["projectId"] = json!("project-two");
    preference_save(&mut s, other);
    let mut disabled = preference_input("disabled", 0, "global");
    disabled["enabled"] = json!(false);
    preference_save(&mut s, disabled);
    assert_eq!(
        active_ids(&s, DATE, &["project-one".into()]),
        vec!["day-one", "global-one", "project-one-pref"]
    );
    assert_eq!(
        active_ids(&s, OTHER_DATE, &[]),
        vec!["global-one", "other-date"]
    );
    let mut archive = project_input("project-one", 1);
    archive["archived"] = json!(true);
    project_save(&mut s, archive);
    assert_eq!(
        active_ids(&s, DATE, &["project-one".into()]),
        vec!["day-one", "global-one"]
    );
    assert_eq!(s.planning.context.preferences.len(), 6);
    assert!(active_preferences(&s, "bad-date", &[]).is_err());
    s.planning
        .context
        .preferences
        .iter_mut()
        .find(|preference| preference.id == "global-one")
        .unwrap()
        .source = "agent".into();
    assert_eq!(active_ids(&s, DATE, &[]), vec!["day-one"]);
}

#[test]
fn preference_scope_requires_exact_fields_and_active_project() {
    let mut s = PaperState::default();
    for (scope, field, value) in [
        ("global", "date", json!(DATE)),
        ("global", "projectId", json!("project-one")),
        ("day", "date", Value::Null),
        ("day", "date", json!("2030-02-29")),
        ("day", "projectId", json!("project-one")),
        ("project", "date", json!(DATE)),
        ("project", "projectId", Value::Null),
        ("unknown", "date", Value::Null),
    ] {
        let mut v = preference_input("preference-one", 0, scope);
        v[field] = value;
        project_failure(&mut s, "save_preference", v, "INVALID_INPUT:");
    }
    let mut missing = preference_input("preference-one", 0, "global");
    missing.as_object_mut().unwrap().remove("projectId");
    project_failure(&mut s, "save_preference", missing, "INVALID_INPUT:");
    project_failure(
        &mut s,
        "save_preference",
        preference_input("preference-one", 0, "project"),
        "NOT_FOUND:",
    );
    let mut archived = project_input("project-one", 0);
    archived["archived"] = json!(true);
    project_save(&mut s, archived);
    project_failure(
        &mut s,
        "save_preference",
        preference_input("preference-one", 0, "project"),
        "CONFLICT:",
    );
}

#[test]
fn preference_corrections_require_current_object_revision_and_only_real_changes_increment_set_revision(
) {
    let mut s = PaperState::default();
    let first = preference_save(&mut s, preference_input("preference-one", 0, "global"));
    project_failure(
        &mut s,
        "save_preference",
        preference_input("preference-one", 0, "global"),
        "CONFLICT:",
    );
    let reused = execute(
        &mut s,
        "save_preference",
        &preference_input("preference-one", 1, "global"),
        "user",
        400,
    )
    .unwrap();
    assert_eq!(reused["reused"], true);
    assert_eq!(reused["preference"], first["preference"]);
    assert_eq!(reused["preferencesRevision"], 1);
    let mut correction = preference_input("preference-one", 1, "global");
    correction["text"] = json!("现在我更喜欢先列出全部选择");
    let saved = execute(&mut s, "save_preference", &correction, "user", 500).unwrap();
    assert_eq!(saved["preference"]["text"], "现在我更喜欢先列出全部选择");
    assert_eq!(saved["preference"]["revision"], 2);
    assert_eq!(saved["preference"]["confirmedAt"], 500);
    assert_eq!(saved["preferencesRevision"], 2);
    preference_save(&mut s, preference_input("other", 0, "day"));
    correction["expectedRevision"] = json!(2);
    correction["enabled"] = json!(false);
    preference_save(&mut s, correction);
    assert_eq!(s.planning.context.preferences_revision, 4);
    assert_eq!(active_ids(&s, DATE, &[]), vec!["other"]);
}

#[test]
fn disabling_and_deleting_stop_injection_and_delete_response_has_no_old_text() {
    let mut s = PaperState::default();
    preference_save(&mut s, preference_input("preference-one", 0, "global"));
    let mut disabled = preference_input("preference-one", 1, "global");
    disabled["enabled"] = json!(false);
    preference_save(&mut s, disabled);
    assert!(active_ids(&s, DATE, &[]).is_empty());
    preference_save(&mut s, preference_input("preference-one", 2, "global"));
    assert_eq!(active_ids(&s, DATE, &[]), vec!["preference-one"]);
    let old = json!({"preferenceId":"preference-one","expectedRevision":2});
    project_failure(&mut s, "delete_preference", old, "CONFLICT:");
    let delete = json!({"preferenceId":"preference-one","expectedRevision":3});
    let result = execute(&mut s, "delete_preference", &delete, "user", 500).unwrap();
    assert_eq!(
        result,
        json!({"deletedId":"preference-one","preferencesRevision":4})
    );
    assert!(active_ids(&s, DATE, &[]).is_empty());
    assert!(s.planning.context.preferences.is_empty());
    project_failure(&mut s, "delete_preference", delete, "NOT_FOUND:");
    project_failure(
        &mut s,
        "save_preference",
        preference_input("preference-one", 3, "global"),
        "CONFLICT:",
    );
}

#[test]
fn preference_text_limits_and_revision_overflow_are_atomic() {
    let mut s = PaperState::default();
    for bad in [json!(" "), json!("字".repeat(1001)), Value::Null, json!(1)] {
        let mut v = preference_input("preference-one", 0, "global");
        v["text"] = bad;
        project_failure(&mut s, "save_preference", v, "INVALID_INPUT:");
    }
    let mut v = preference_input("preference-one", 0, "global");
    v["text"] = json!("字".repeat(1000));
    preference_save(&mut s, v);
    s.planning.context.preferences_revision = u64::MAX;
    let mut change = preference_input("preference-one", 1, "global");
    change["enabled"] = json!(false);
    project_failure(&mut s, "save_preference", change, "INVALID_STATE:");
    project_failure(
        &mut s,
        "delete_preference",
        json!({"preferenceId":"preference-one","expectedRevision":1}),
        "INVALID_STATE:",
    );
}

#[test]
fn preference_writes_require_user_before_lookup() {
    let mut s = PaperState::default();
    let before = snapshot(&s);
    for source in ["agent", "hermes", "system", ""] {
        for action in ["save_preference", "delete_preference"] {
            assert!(execute(&mut s, action, &json!({}), source, 300)
                .unwrap_err()
                .starts_with("FORBIDDEN:"));
        }
    }
    assert_eq!(snapshot(&s), before);
}

#[test]
fn an_existing_archived_project_preference_can_be_disabled_but_not_newly_created_or_enabled() {
    let mut s = PaperState::default();
    project_save(&mut s, project_input("project-one", 0));
    preference_save(&mut s, preference_input("existing", 0, "project"));
    let mut archive = project_input("project-one", 1);
    archive["archived"] = json!(true);
    project_save(&mut s, archive);
    let mut disabled = preference_input("existing", 1, "project");
    disabled["enabled"] = json!(false);
    preference_save(&mut s, disabled);
    assert!(!s.planning.context.preferences[0].enabled);
    assert!(active_ids(&s, DATE, &["project-one".into()]).is_empty());
    project_failure(
        &mut s,
        "save_preference",
        preference_input("existing", 2, "project"),
        "CONFLICT:",
    );
    let mut new_disabled = preference_input("new", 0, "project");
    new_disabled["enabled"] = json!(false);
    project_failure(&mut s, "save_preference", new_disabled, "CONFLICT:");
    preference_save(&mut s, preference_input("global-one", 0, "global"));
    let mut change_scope = preference_input("global-one", 1, "project");
    change_scope["enabled"] = json!(false);
    project_failure(&mut s, "save_preference", change_scope, "CONFLICT:");
}

#[test]
fn preference_public_transactions_cache_exact_retries_and_preserve_historical_events() {
    let mut c = crate::paper::open(std::path::Path::new(":memory:")).unwrap();
    let mut create = preference_input("preference-one", 0, "global");
    create["requestId"] = json!(uuid::Uuid::new_v4().to_string());
    let (first, changed) =
        crate::paper::execute(&mut c, "save_preference", create.clone(), "user").unwrap();
    assert!(changed);
    let (retry, changed) =
        crate::paper::execute(&mut c, "save_preference", create.clone(), "user").unwrap();
    assert!(!changed);
    assert_eq!(first, retry);
    let delete = json!({"preferenceId":"preference-one","expectedRevision":1,"requestId":uuid::Uuid::new_v4().to_string()});
    let (first, changed) =
        crate::paper::execute(&mut c, "delete_preference", delete.clone(), "user").unwrap();
    assert!(changed);
    let (retry, changed) =
        crate::paper::execute(&mut c, "delete_preference", delete, "user").unwrap();
    assert!(!changed);
    assert_eq!(first, retry);
    assert_eq!(first["deletedId"], "preference-one");
    assert_eq!(first["preferencesRevision"], 2);
    assert!(first.get("text").is_none());
    assert!(first.get("preference").is_none());
    let state = crate::paper::load(&c).unwrap();
    assert!(active_preferences(&state, DATE, &[]).unwrap().is_empty());
    let saved_event: String = c
        .query_row(
            "SELECT data FROM paper_events WHERE json_extract(data,'$.kind')='save_preference'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(saved_event.contains("我希望每轮先做一个小步骤"));
    let deletion_event: String = c
        .query_row(
            "SELECT data FROM paper_events WHERE json_extract(data,'$.kind')='delete_preference'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!deletion_event.contains("我希望每轮先做一个小步骤"));
    assert_eq!(c.query_row("SELECT COUNT(*) FROM paper_events WHERE json_extract(data,'$.kind') IN ('save_preference','delete_preference')",[],|r|r.get::<_,i64>(0)).unwrap(),2);
    create["text"] = json!("复用旧requestId不得重新创建偏好");
    assert!(
        crate::paper::execute(&mut c, "save_preference", create, "user")
            .unwrap_err()
            .starts_with("REQUEST_ID_REUSED:")
    );
    assert_eq!(snapshot(&state), snapshot(&crate::paper::load(&c).unwrap()));
}
