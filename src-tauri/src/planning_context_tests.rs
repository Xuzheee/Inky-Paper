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
