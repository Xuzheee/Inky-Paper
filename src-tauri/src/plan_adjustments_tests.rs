use super::*;

const DATE: &str = "2030-03-04";
const NOW: i64 = 1_898_899_200_000;
fn uid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn state() -> PaperState {
    let v: Value = serde_json::from_str(include_str!(
        "../../scripts/fixtures/p0p1/legacy-state.json"
    ))
    .unwrap();
    serde_json::from_value(v["state"].clone()).unwrap()
}
fn base(s: &PaperState, step: usize, kind: &str) -> Value {
    let step = &s.planning.steps[step];
    let task = s.tasks.iter().find(|t| t.id == step.task_id).unwrap();
    json!({"kind":kind,"taskId":task.id,"stepId":step.id,"expectedTaskRevision":task.revision,"expectedStepRevision":step.revision})
}
fn narrow(s: &PaperState, step: usize, d: Option<&str>) -> Value {
    let mut a = base(s, step, "narrow");
    a["newStepId"] = json!(uid());
    a["text"] = json!("先写一条可以核对的结果");
    a["expectedResult"] = json!("一条可核对的句子");
    a["plannedSeconds"] = json!(300);
    a["date"] = json!(d);
    a
}
fn reschedule(s: &PaperState, i: usize, d: &str) -> Value {
    let item = &s.planning.day_items[i];
    let step = s
        .planning
        .steps
        .iter()
        .position(|x| x.id == item.step_id)
        .unwrap();
    let mut a = base(s, step, "reschedule");
    a["itemId"] = json!(item.id);
    a["expectedItemRevision"] = json!(item.revision);
    a["date"] = json!(d);
    a["startMinute"] = Value::Null;
    a["durationMinutes"] = json!(20);
    a
}
fn reservation(s: &PaperState, i: usize, duration: Option<u32>) -> Value {
    let mut a = reschedule(s, i, DATE);
    a["kind"] = json!("reservation");
    a.as_object_mut().unwrap().remove("date");
    a.as_object_mut().unwrap().remove("startMinute");
    a["durationMinutes"] = json!(duration);
    a
}
fn reorder(s: &PaperState, d: &str) -> Value {
    let mut items: Vec<_> = s
        .planning
        .day_items
        .iter()
        .filter(|x| x.date == d && x.removed_at.is_none())
        .collect();
    items.sort_by_key(|i| i.order);
    items.reverse();
    json!({"kind":"reorder","date":d,"items":items.iter().map(|i| json!({"id":i.id,"revision":i.revision})).collect::<Vec<_>>()})
}
fn group_input(actions: Vec<Value>) -> Value {
    json!({"id":uid(),"reason":"先降低启动成本，再保留后续安排。","actions":actions})
}
fn propose(s: &mut PaperState, groups: Vec<Value>) -> Value {
    execute(
        s,
        "propose_plan_adjustment",
        &json!({"batchId":uid(),"groups":groups}),
        "hermes",
        NOW,
    )
    .unwrap()["batch"]
        .clone()
}
fn adopt(s: &mut PaperState, batch: &Value, ids: Vec<Value>) -> Result<Value, String> {
    execute(
        s,
        "adopt_plan_adjustment",
        &json!({"batchId":batch["id"],"expectedRevision":batch["revision"],"groupIds":ids}),
        "user",
        NOW + 1000,
    )
}
fn plans(s: &PaperState) -> Value {
    json!({"tasks":s.tasks,"steps":s.planning.steps,"items":s.planning.day_items,"sessions":s.sessions,"links":s.planning.session_links,"notes":s.notes,"prepared":s.planning.prepared})
}

#[test]
fn preview_is_read_only_and_narrow_preserves_original_goal_and_execution_history() {
    let mut s = state();
    let before = plans(&s);
    let a = narrow(&s, 2, Some(DATE));
    let sid = a["newStepId"].clone();
    let batch = propose(&mut s, vec![group_input(vec![a])]);
    assert_eq!(plans(&s), before);
    assert_eq!(
        batch["groups"][0]["before"]["tasks"][0]["title"],
        "今日写作"
    );
    let preview_id = batch["groups"][0]["after"]["dayItems"][0]["id"].clone();
    let adopted = adopt(&mut s, &batch, vec![batch["groups"][0]["id"].clone()]).unwrap();
    assert_eq!(s.planning.steps.len(), 8);
    assert_eq!(s.planning.day_items.len(), 8);
    assert!(s.planning.steps.iter().any(|x| json!(x.id) == sid));
    assert!(s
        .planning
        .day_items
        .iter()
        .any(|x| json!(x.id) == preview_id));
    assert_eq!(json!(s.planning.steps[2]), before["steps"][2]);
    assert_eq!(
        json!(s.tasks[1].next_action),
        before["tasks"][1]["nextAction"]
    );
    assert_eq!(json!(s.sessions), before["sessions"]);
    assert_eq!(json!(s.planning.session_links), before["links"]);
    let once = plans(&s);
    assert!(adopt(
        &mut s,
        &adopted["batch"],
        vec![batch["groups"][0]["id"].clone()]
    )
    .unwrap_err()
    .starts_with("CONFLICT"));
    assert_eq!(plans(&s), once);
}

#[test]
fn two_same_task_groups_can_be_adopted_separately_without_accepting_external_edits() {
    let mut s = state();
    let groups = vec![
        group_input(vec![narrow(&s, 0, None)]),
        group_input(vec![narrow(&s, 1, None)]),
    ];
    let batch = propose(&mut s, groups);
    let first = adopt(&mut s, &batch, vec![batch["groups"][0]["id"].clone()]).unwrap();
    assert_eq!(s.tasks[0].revision, 2);
    assert_eq!(
        first["batch"]["groups"][1]["actions"][0]["expectedTaskRevision"],
        2
    );
    let second = adopt(
        &mut s,
        &first["batch"],
        vec![batch["groups"][1]["id"].clone()],
    )
    .unwrap();
    assert_eq!(s.tasks[0].revision, 3);
    assert_eq!(second["batch"]["revision"], 3);
    assert_eq!(s.planning.steps.len(), 9);

    let mut s = state();
    let groups = vec![
        group_input(vec![narrow(&s, 0, None)]),
        group_input(vec![narrow(&s, 2, None)]),
    ];
    let batch = propose(&mut s, groups);
    s.tasks[1].title = "外部真实修改".into();
    s.tasks[1].revision += 1;
    let first = adopt(&mut s, &batch, vec![batch["groups"][0]["id"].clone()]).unwrap();
    assert_eq!(
        first["batch"]["groups"][1]["actions"][0]["expectedTaskRevision"],
        1
    );
    let before = json!(s);
    assert!(adopt(
        &mut s,
        &first["batch"],
        vec![batch["groups"][1]["id"].clone()]
    )
    .unwrap_err()
    .starts_with("CONFLICT"));
    assert_eq!(json!(s), before);
}

#[test]
fn all_selected_groups_validate_against_initial_state_and_any_stale_group_rolls_back() {
    let mut s = state();
    let groups = vec![
        group_input(vec![narrow(&s, 0, None)]),
        group_input(vec![narrow(&s, 1, None)]),
    ];
    let batch = propose(&mut s, groups);
    let ids = batch["groups"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["id"].clone())
        .collect();
    adopt(&mut s, &batch, ids).unwrap();
    assert_eq!(s.tasks[0].revision, 3);
    assert_eq!(s.planning.steps.len(), 9);

    let mut s = state();
    let groups = vec![
        group_input(vec![narrow(&s, 0, None)]),
        group_input(vec![narrow(&s, 2, None)]),
    ];
    let batch = propose(&mut s, groups);
    s.planning.steps[2].revision += 1;
    let before = json!(s);
    let ids = batch["groups"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["id"].clone())
        .collect();
    assert!(adopt(&mut s, &batch, ids)
        .unwrap_err()
        .starts_with("CONFLICT"));
    assert_eq!(json!(s), before);
}

#[test]
fn multi_action_group_accepts_original_versions_once_and_preserves_old_step() {
    let mut s = state();
    let actions = vec![
        narrow(&s, 2, None),
        reschedule(&s, 2, "2030-03-06"),
        reservation(&s, 2, Some(35)),
    ];
    let batch = propose(&mut s, vec![group_input(actions)]);
    let original = s.planning.steps[2].clone();
    adopt(&mut s, &batch, vec![batch["groups"][0]["id"].clone()]).unwrap();
    assert_eq!(s.planning.day_items[2].date, "2030-03-06");
    assert_eq!(s.planning.day_items[2].duration_minutes, Some(35));
    assert_eq!(s.planning.day_items[2].revision, 3);
    assert_eq!(json!(s.planning.steps[2]), json!(original));
}

#[test]
fn cross_group_membership_and_reorder_dependencies_are_rejected_before_preview_save() {
    let mut s = state();
    let groups = vec![
        group_input(vec![narrow(&s, 2, Some(DATE))]),
        group_input(vec![reorder(&s, DATE)]),
    ];
    let before = json!(s);
    assert!(execute(
        &mut s,
        "propose_plan_adjustment",
        &json!({"batchId":uid(),"groups":groups}),
        "hermes",
        NOW
    )
    .unwrap_err()
    .starts_with("INVALID_INPUT"));
    assert_eq!(json!(s), before);
}

#[test]
fn reorder_needs_complete_unchanged_day_and_supports_completed_rows() {
    let mut s = state();
    let action = reorder(&s, DATE);
    let wanted = action["items"][0]["id"].clone();
    let batch = propose(&mut s, vec![group_input(vec![action])]);
    adopt(&mut s, &batch, vec![batch["groups"][0]["id"].clone()]).unwrap();
    assert_eq!(
        s.planning
            .day_items
            .iter()
            .find(|x| json!(x.id) == wanted)
            .unwrap()
            .order,
        0
    );
    assert!(s.tasks[5].completed);
    assert!(s.planning.steps[6].completed);
    let mut bad = reorder(&s, DATE);
    bad["items"].as_array_mut().unwrap().pop();
    let before = json!(s);
    assert!(execute(
        &mut s,
        "propose_plan_adjustment",
        &json!({"batchId":uid(),"groups":[group_input(vec![bad])]}),
        "hermes",
        NOW
    )
    .is_err());
    assert_eq!(json!(s), before);
}

#[test]
fn continue_keeps_old_source_link_and_reuses_target() {
    let mut s = state();
    let mut a = base(&s, 0, "continue");
    a["date"] = json!(DATE);
    a["items"] = json!([{"id":s.planning.day_items[0].id,"revision":s.planning.day_items[0].revision},{"id":s.planning.day_items[1].id,"revision":s.planning.day_items[1].revision}]);
    let links = json!(s.planning.session_links);
    let sessions = json!(s.sessions);
    let batch = propose(&mut s, vec![group_input(vec![a])]);
    let expected = batch["groups"][0]["after"]["dayItems"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["date"] == DATE)
        .unwrap()["id"]
        .clone();
    adopt(&mut s, &batch, vec![batch["groups"][0]["id"].clone()]).unwrap();
    assert_eq!(s.planning.day_items[0].date, "2030-03-02");
    assert_eq!(json!(s.planning.day_items[0].continued_to), expected);
    assert_eq!(
        s.planning.day_items[1].resolution.as_deref(),
        Some("continued")
    );
    assert_eq!(json!(s.planning.session_links), links);
    assert_eq!(json!(s.sessions), sessions);
    assert_eq!(
        s.planning
            .day_items
            .iter()
            .filter(|x| x.step_id == s.planning.steps[0].id
                && x.date == DATE
                && x.removed_at.is_none())
            .count(),
        1
    );
}

#[test]
fn reservation_supports_duration_only_and_cancellation_clears_start() {
    let mut s = state();
    let a = reservation(&s, 0, Some(40));
    let batch = propose(&mut s, vec![group_input(vec![a])]);
    adopt(&mut s, &batch, vec![batch["groups"][0]["id"].clone()]).unwrap();
    assert_eq!(s.planning.day_items[0].start_minute, None);
    assert_eq!(s.planning.day_items[0].duration_minutes, Some(40));
    let a = reservation(&s, 2, None);
    let batch = propose(&mut s, vec![group_input(vec![a])]);
    assert!(batch["groups"][0]["after"]["dayItems"][0]["startMinute"].is_null());
    adopt(&mut s, &batch, vec![batch["groups"][0]["id"].clone()]).unwrap();
    assert_eq!(s.planning.day_items[2].start_minute, None);
    assert_eq!(s.planning.day_items[2].duration_minutes, None);
}

#[test]
fn active_affected_sessions_block_adoption_but_allow_preview() {
    for status in ["running", "paused", "waiting"] {
        let mut s = state();
        s.sessions[0].status = status.into();
        let g = group_input(vec![narrow(&s, 0, None)]);
        let batch = propose(&mut s, vec![g]);
        let before = json!(s);
        assert!(
            adopt(&mut s, &batch, vec![batch["groups"][0]["id"].clone()])
                .unwrap_err()
                .starts_with("ACTIVE_SESSION")
        );
        assert_eq!(json!(s), before);
        let g = group_input(vec![narrow(&s, 2, None)]);
        let batch = propose(&mut s, vec![g]);
        adopt(&mut s, &batch, vec![batch["groups"][0]["id"].clone()]).unwrap();
    }
}

#[test]
fn local_revision_rebuilds_preview_without_committing_plan_and_rejects_stale_basis() {
    let mut s = state();
    let g = group_input(vec![reschedule(&s, 2, "2030-03-06")]);
    let batch = propose(&mut s, vec![g.clone()]);
    let before = plans(&s);
    let mut edited = g;
    edited["actions"][0]["date"] = json!("2030-03-07");
    let request = json!({"batchId":batch["id"],"expectedRevision":1,"groups":[edited]});
    assert!(
        execute(&mut s, "revise_plan_adjustment", &request, "hermes", NOW)
            .unwrap_err()
            .starts_with("FORBIDDEN")
    );
    let revised = execute(&mut s, "revise_plan_adjustment", &request, "user", NOW).unwrap();
    assert_eq!(plans(&s), before);
    assert_eq!(revised["batch"]["revision"], 2);
    assert_eq!(
        revised["batch"]["groups"][0]["after"]["dayItems"][0]["date"],
        "2030-03-07"
    );
    s.tasks[1].revision += 1;
    let mut request = request;
    request["expectedRevision"] = json!(2);
    // Supplying a new expected task revision must not erase the original stale guard.
    request["groups"][0]["actions"][0]["expectedTaskRevision"] = json!(2);
    let before = json!(s);
    assert!(
        execute(&mut s, "revise_plan_adjustment", &request, "user", NOW)
            .unwrap_err()
            .starts_with("CONFLICT")
    );
    assert_eq!(json!(s), before);
}

#[test]
fn invalid_shapes_and_model_adoption_cannot_change_state() {
    let mut s = state();
    let mut wrong = narrow(&s, 2, None);
    wrong["date"] = json!("2030-02-30");
    let original = json!(s);
    assert!(execute(
        &mut s,
        "propose_plan_adjustment",
        &json!({"batchId":uid(),"groups":[group_input(vec![wrong])]}),
        "hermes",
        NOW
    )
    .is_err());
    assert_eq!(json!(s), original);
    let a = narrow(&s, 2, None);
    let batch = propose(&mut s, vec![group_input(vec![a])]);
    let before = json!(s);
    assert!(execute(
        &mut s,
        "adopt_plan_adjustment",
        &json!({"batchId":batch["id"],"expectedRevision":1,"groupIds":[batch["groups"][0]["id"]]}),
        "hermes",
        NOW
    )
    .unwrap_err()
    .starts_with("FORBIDDEN"));
    assert_eq!(json!(s), before);
    assert_eq!(
        execute(
            &mut s,
            "get_plan_adjustment",
            &json!({"batchId":batch["id"]}),
            "hermes",
            NOW
        )
        .unwrap()["batch"],
        batch
    );
}

#[test]
fn date_only_move_preserves_time_and_explicit_duration_clear_is_previewed() {
    let mut s = state();
    let mut a = reschedule(&s, 2, "2030-03-06");
    a.as_object_mut().unwrap().remove("startMinute");
    a.as_object_mut().unwrap().remove("durationMinutes");
    let batch = propose(&mut s, vec![group_input(vec![a.clone()])]);
    let after = &batch["groups"][0]["after"]["dayItems"][0];
    assert_eq!(after["startMinute"], 600);
    assert_eq!(after["durationMinutes"], 45);
    adopt(&mut s, &batch, vec![batch["groups"][0]["id"].clone()]).unwrap();
    assert_eq!(s.planning.day_items[2].start_minute, Some(600));
    assert_eq!(s.planning.day_items[2].duration_minutes, Some(45));
    a["expectedItemRevision"] = json!(s.planning.day_items[2].revision);
    a["date"] = json!("2030-03-07");
    a["durationMinutes"] = Value::Null;
    let batch = propose(&mut s, vec![group_input(vec![a])]);
    let after = &batch["groups"][0]["after"]["dayItems"][0];
    assert!(after["startMinute"].is_null());
    assert!(after["durationMinutes"].is_null());
}

#[test]
fn sqlite_transaction_retry_reuses_result_and_records_changes_once() {
    let mut c = crate::paper::open(std::path::Path::new(":memory:")).unwrap();
    let s = state();
    c.execute(
        "UPDATE paper_state SET data=?1",
        [serde_json::to_string(&s).unwrap()],
    )
    .unwrap();
    let request = json!({"batchId":uid(),"requestId":uid(),"groups":[group_input(vec![narrow(&s,2,Some(DATE))])]});
    let (proposal, _) =
        crate::paper::execute(&mut c, "propose_plan_adjustment", request.clone(), "hermes")
            .unwrap();
    assert_eq!(plans(&crate::paper::load(&c).unwrap()), plans(&s));
    let (again, changed) =
        crate::paper::execute(&mut c, "propose_plan_adjustment", request, "hermes").unwrap();
    assert!(!changed);
    assert_eq!(again, proposal);
    let request = json!({"batchId":proposal["batch"]["id"],"expectedRevision":1,"groupIds":[proposal["batch"]["groups"][0]["id"]],"requestId":uid()});
    let (adopted, _) =
        crate::paper::execute(&mut c, "adopt_plan_adjustment", request.clone(), "user").unwrap();
    let before = crate::paper::load(&c).unwrap();
    assert_eq!(before.planning.plan_changes.len(), 1);
    assert_eq!(
        before.planning.plan_changes[0].operation,
        "adopt_plan_adjustment"
    );
    assert_eq!(json!(before.sessions), json!(s.sessions));
    let (again, changed) =
        crate::paper::execute(&mut c, "adopt_plan_adjustment", request, "user").unwrap();
    assert!(!changed);
    assert_eq!(again, adopted);
    assert_eq!(json!(crate::paper::load(&c).unwrap()), json!(before));
}

#[test]
fn reorder_preview_keeps_the_unchanged_middle_item_and_context() {
    let mut s = state();
    let a = reorder(&s, DATE);
    let batch = propose(&mut s, vec![group_input(vec![a])]);
    let g = &batch["groups"][0];
    assert_eq!(g["before"]["dayItems"].as_array().unwrap().len(), 3);
    assert_eq!(g["after"]["dayItems"].as_array().unwrap().len(), 3);
    assert_eq!(g["after"]["steps"].as_array().unwrap().len(), 3);
    let unchanged = s
        .planning
        .day_items
        .iter()
        .find(|x| x.date == DATE && x.order == 1)
        .unwrap();
    assert!(g["after"]["dayItems"]
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x["id"] == unchanged.id && x["revision"] == unchanged.revision));
}

#[test]
fn different_groups_cannot_silently_overwrite_the_same_arrangement() {
    for kind in ["reschedule", "reservation", "reorder"] {
        let mut s = state();
        let first = reschedule(&s, 2, "2030-03-06");
        let second = match kind {
            "reschedule" => reschedule(&s, 2, "2030-03-07"),
            "reservation" => reservation(&s, 2, Some(15)),
            _ => reorder(&s, DATE),
        };
        let before = json!(s);
        let request =
            json!({"batchId":uid(),"groups":[group_input(vec![first]),group_input(vec![second])]});
        assert!(
            execute(&mut s, "propose_plan_adjustment", &request, "hermes", NOW)
                .unwrap_err()
                .starts_with("INVALID_INPUT")
        );
        assert_eq!(json!(s), before);
    }
}

#[test]
fn continue_preview_reuses_existing_target_and_keeps_its_reservation() {
    let mut s = state();
    let target = DayItem {
        id: uid(),
        task_id: s.tasks[0].id.clone(),
        step_id: s.planning.steps[0].id.clone(),
        date: DATE.into(),
        order: 3,
        revision: 1,
        start_minute: Some(720),
        duration_minutes: Some(40),
        ..DayItem::default()
    };
    s.planning.day_items.push(target.clone());
    let mut a = base(&s, 0, "continue");
    a["date"] = json!(DATE);
    a["items"] =
        json!([{"id":s.planning.day_items[0].id,"revision":s.planning.day_items[0].revision}]);
    let batch = propose(&mut s, vec![group_input(vec![a])]);
    for side in ["before", "after"] {
        assert!(batch["groups"][0][side]["dayItems"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["id"] == target.id && i["durationMinutes"] == 40));
    }
    adopt(&mut s, &batch, vec![batch["groups"][0]["id"].clone()]).unwrap();
    assert_eq!(s.planning.day_items.len(), 8);
    assert_eq!(
        s.planning.day_items[0].continued_to.as_deref(),
        Some(target.id.as_str())
    );
    assert_eq!(json!(s.planning.day_items.last().unwrap()), json!(target));
}
