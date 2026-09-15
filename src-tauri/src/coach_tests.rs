use super::*;
use crate::paper::{execute as paper_execute, open, Task};
fn state() -> PaperState {
    let mut s = PaperState::default();
    s.tasks.push(Task {
        id: "task".into(),
        title: "学习与开发".into(),
        due: None,
        category: "work".into(),
        priority: "medium".into(),
        completed: false,
        next_action: Some(Action {
            id: "action".into(),
            text: "验证登录流程".into(),
            completed: false,
            source: "user".into(),
        }),
        revision: 1,
        source: "user".into(),
        created_at: 0,
        updated_at: 0,
        completed_at: None,
    });
    s
}
fn setup(seconds: u64) -> (PaperState, Connection, i64) {
    let mut s = state();
    // Activity tests opt into local records; this never permits automatic coaching.
    s.coach.settings.enabled = true;
    let c = open(std::path::Path::new(":memory:")).unwrap();
    let t = 1_800_000_000_000;
    execute(&mut s,&c,"start_work",&json!({"taskId":"task","expectedRevision":1,"plannedEndAt":t+3_600_000,"plannedSeconds":seconds}),"user",t).unwrap();
    (s, c, t)
}
fn block_input(s: &PaperState) -> Value {
    let b = current(s).unwrap();
    json!({"blockId":b.id,"expectedRevision":b.revision})
}
fn sample(s: &mut PaperState, c: &Connection, t: i64, title: &str) {
    execute(
        s,
        c,
        "coach_observe",
        &json!({"app":"browser.exe","title":title,"idleMs":0}),
        "system",
        t,
    )
    .unwrap();
}
fn legacy_episode() -> (PaperState, Connection, i64) {
    let (mut s, c, t) = setup(0);
    sample(&mut s, &c, t, "unrelated-video");
    let key = s.coach.activities[0].key.clone();
    let mut v = block_input(&s);
    v["key"] = json!(key);
    v["relation"] = json!("unrelated");
    execute(&mut s, &c, "label_activity", &v, "user", t).unwrap();
    s.coach.episodes.push(Episode {
        id: id(),
        block_id: current(&s).unwrap().id.clone(),
        task_revision: s.tasks[0].revision,
        key,
        reason: "unrelated_context".into(),
        status: "pending".into(),
        created_at: t,
        shown_at: vec![],
        next_at: t,
        response: None,
    });
    (s, c, t)
}
#[test]
fn work_start_is_atomic_idempotent_and_unknown_energy_is_preserved() {
    let mut c = open(std::path::Path::new(":memory:")).unwrap();
    let tid = id();
    paper_execute(
        &mut c,
        "create_task",
        json!({"requestId":id(),"taskId":tid,"title":"真实任务"}),
        "user",
    )
    .unwrap();
    let t = chrono::Utc::now().timestamp_millis();
    let v = json!({"requestId":id(),"taskId":tid,"expectedRevision":1,"plannedEndAt":t+3600000,"plannedSeconds":1500});
    paper_execute(&mut c, "start_work", v.clone(), "user").unwrap();
    paper_execute(&mut c, "start_work", v, "user").unwrap();
    let result = paper_execute(&mut c, "get_state", json!({}), "user")
        .unwrap()
        .0;
    assert_eq!(
        result["state"]["coach"]["blocks"].as_array().unwrap().len(),
        1
    );
    assert_eq!(result["state"]["sessions"].as_array().unwrap().len(), 1);
    assert!(result["state"]["coach"]["blocks"][0]["energy"].is_null());
    assert_eq!(
        result["state"]["coach"]["blocks"][0]["sessionIds"][0],
        result["state"]["sessions"][0]["id"]
    );
    let mut other = open(std::path::Path::new(":memory:")).unwrap();
    let tid = id();
    paper_execute(
        &mut other,
        "create_task",
        json!({"requestId":id(),"taskId":tid,"title":"另一任务"}),
        "user",
    )
    .unwrap();
    assert!(paper_execute(&mut other,"start_work",json!({"requestId":id(),"taskId":tid,"expectedRevision":1,"plannedEndAt":t+3600000,"plannedSeconds":4}),"user").is_err());
    let result = paper_execute(&mut other, "get_state", json!({}), "user")
        .unwrap()
        .0;
    assert!(result["state"]["tasks"][0]["nextAction"].is_null());
}
#[test]
fn waiting_pauses_only_by_user_and_expiry_does_not_end_clock() {
    let (mut s, c, t) = setup(1500);
    let mut v = block_input(&s);
    v["mode"] = json!("waiting_ai");
    assert!(execute(&mut s, &c, "set_work_mode", &v, "hermes", t + 10_000).is_err());
    execute(&mut s, &c, "set_work_mode", &v, "user", t + 10_000).unwrap();
    assert_eq!(s.sessions[0].elapsed_seconds, 10);
    assert_eq!(paper::elapsed(&s.sessions[0], t + 100_000), 10);
    let mut v = block_input(&s);
    v["mode"] = json!("working");
    execute(&mut s, &c, "set_work_mode", &v, "user", t + 100_000).unwrap();
    assert_eq!(s.sessions[0].status, "running");
    maintain(&mut s, t + 3_600_001);
    assert_eq!(current(&s).unwrap().status, "expired");
    assert_eq!(s.sessions[0].status, "running");
    assert_eq!(prompt(&s, t + 3_600_001)["kind"], "work_end");
}
#[test]
fn reading_and_sampling_gaps_do_not_create_false_episodes() {
    let (mut s, c, t) = setup(0);
    for n in 0..80 {
        execute(
            &mut s,
            &c,
            "coach_observe",
            &json!({"app":"browser.exe","title":"学习资料","idleMs":n*5000}),
            "system",
            t + n * 5000,
        )
        .unwrap();
    }
    assert!(s.coach.episodes.is_empty());
    let key = s.coach.activities.last().unwrap().key.clone();
    let mut v = block_input(&s);
    v["key"] = json!(key);
    v["relation"] = json!("unrelated");
    execute(&mut s, &c, "label_activity", &v, "user", t + 400_000).unwrap();
    sample(&mut s, &c, t + 1_000_000, "学习资料");
    assert!(s.coach.episodes.is_empty());
    assert_eq!(s.coach.activities.last().unwrap().started_at, t + 1_000_000);
}
#[test]
fn legacy_enabled_settings_and_classified_activity_do_not_create_prompts() {
    for mode in ["working", "paused"] {
        let (mut s, c, t) = setup(0);
        s.coach.settings.hermes = true;
        sample(&mut s, &c, t, "unrelated-video");
        let mut v = block_input(&s);
        v["key"] = json!(s.coach.activities[0].key);
        v["relation"] = json!("unrelated");
        execute(&mut s, &c, "label_activity", &v, "user", t).unwrap();
        s.coach.blocks[0].mode = mode.into();
        for n in 1..=120 {
            sample(&mut s, &c, t + n * 5000, "unrelated-video");
            assert!(prompt(&s, t + n * 5000).is_null());
        }
        assert!(!s.coach.activities.is_empty());
        assert!(s.coach.episodes.is_empty());
        assert!(s.coach.proposals.is_empty());
        assert_eq!(s.coach.last_analysis_at, 0);
    }
}
#[test]
fn unread_legacy_episodes_are_cancelled_once_without_losing_history() {
    let (mut s, c, t) = legacy_episode();
    s.coach.settings.hermes = true;
    let old_settings_revision = s.coach.settings.revision;
    let mut shown = s.coach.episodes[0].clone();
    shown.id = id();
    shown.status = "exhausted".into();
    shown.shown_at = vec![t - 10, t - 5];
    s.coach.episodes.push(shown);
    assert!(prompt(&s, t).is_null());
    let eid = s.coach.episodes[0].id.clone();
    assert!(execute(
        &mut s,
        &c,
        "coach_prompt_shown",
        &json!({"episodeId":eid}),
        "user",
        t
    )
    .is_err());
    assert!(maintain(&mut s, t));
    assert!(s.coach.settings.enabled);
    assert!(!s.coach.settings.hermes);
    assert_eq!(s.coach.settings.revision, old_settings_revision + 1);
    assert_eq!(s.coach.episodes.len(), 2);
    assert!(s
        .coach
        .episodes
        .iter()
        .all(|episode| episode.status == "cancelled"));
    assert_eq!(s.coach.episodes[1].shown_at, vec![t - 10, t - 5]);
    assert!(!maintain(&mut s, t + 1));
    assert_eq!(s.tasks[0].revision, 1);
}
#[test]
fn explicit_rest_cancels_a_pending_retry() {
    let (mut s, c, t) = legacy_episode();
    let mut v = block_input(&s);
    v["mode"] = json!("rest");
    execute(&mut s, &c, "set_work_mode", &v, "user", t + 5000).unwrap();
    assert_eq!(s.coach.episodes[0].status, "cancelled");
    assert!(prompt(&s, t + 300_000).is_null());
}
#[test]
fn proposal_staleness_and_active_clock_protect_history() {
    let (mut s, c, t) = setup(1500);
    let bid = current(&s).unwrap().id.clone();
    let v = json!({"blockId":bid,"taskId":"task","expectedTaskRevision":1,"kind":"step","text":"检查返回的错误码","reason":"先定位问题"});
    execute(&mut s, &c, "propose_coaching_action", &v, "hermes", t).unwrap();
    let pid = s.coach.proposals[0].id.clone();
    assert!(execute(
        &mut s,
        &c,
        "respond_coach_proposal",
        &json!({"proposalId":pid,"response":"accept"}),
        "user",
        t + 100
    )
    .is_err());
    assert_eq!(s.sessions[0].action.as_ref().unwrap().text, "验证登录流程");
    s.tasks[0].revision += 1;
    maintain(&mut s, t + 200);
    assert_eq!(s.coach.proposals[0].status, "expired");
}
#[test]
fn progress_does_not_complete_task_and_clock_can_be_kept() {
    let (mut s, c, t) = setup(1500);
    let mut v = block_input(&s);
    v["progress"] = json!("achieved");
    v["finishSession"] = json!(false);
    execute(&mut s, &c, "end_work", &v, "user", t + 1000).unwrap();
    assert!(!s.tasks[0].completed);
    assert!(!s.tasks[0].next_action.as_ref().unwrap().completed);
    assert_eq!(s.sessions[0].status, "running");
    assert!(current(&s).is_none());
}
#[test]
fn raw_titles_are_not_written_to_events_or_request_cache() {
    let mut c = open(std::path::Path::new(":memory:")).unwrap();
    let tid = id();
    paper_execute(
        &mut c,
        "create_task",
        json!({"requestId":id(),"taskId":tid,"title":"隐私验收"}),
        "user",
    )
    .unwrap();
    let t = chrono::Utc::now().timestamp_millis();
    paper_execute(&mut c,"start_work",json!({"requestId":id(),"taskId":tid,"expectedRevision":1,"plannedEndAt":t+3600000,"plannedSeconds":0}),"user").unwrap();
    paper_execute(
        &mut c,
        "coach_settings",
        json!({"requestId":id(),"expectedRevision":1,"enabled":true}),
        "user",
    )
    .unwrap();
    paper_execute(
        &mut c,
        "coach_observe",
        json!({"app":"browser.exe","title":"PRIVATE_TITLE_SENTINEL","idleMs":0}),
        "system",
    )
    .unwrap();
    let result = paper_execute(&mut c, "get_state", json!({}), "user")
        .unwrap()
        .0;
    let b = &result["state"]["coach"]["blocks"][0];
    paper_execute(
        &mut c,
        "update_work",
        json!({"requestId":id(),"blockId":b["id"],"expectedRevision":b["revision"],"energy":"low"}),
        "user",
    )
    .unwrap();
    let e: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM paper_events WHERE data LIKE '%PRIVATE_TITLE_SENTINEL%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let r:i64=c.query_row("SELECT COUNT(*) FROM paper_requests WHERE result LIKE '%PRIVATE_TITLE_SENTINEL%' OR fingerprint LIKE '%PRIVATE_TITLE_SENTINEL%'",[],|r|r.get(0)).unwrap();
    assert_eq!((e, r), (0, 0));
}

#[test]
fn old_state_loads_and_feedback_is_available_to_hermes() {
    let legacy = json!({"tasks":[],"sessions":[],"notes":[]});
    let old: PaperState = serde_json::from_value(legacy).unwrap();
    assert!(old.coach.blocks.is_empty());
    let (mut s, c, t) = setup(0);
    let mut v = block_input(&s);
    v["mode"] = json!("waiting_ai");
    execute(&mut s, &c, "set_work_mode", &v, "user", t + 1000).unwrap();
    assert_eq!(
        current(&s).unwrap().phases.last().unwrap().mode,
        "waiting_ai"
    );
    let mut v = block_input(&s);
    v["progress"] = json!("advanced");
    v["output"] = json!("error reproduced");
    execute(&mut s, &c, "end_work", &v, "user", t + 2000).unwrap();
    assert_eq!(
        context(&s, t + 3000)["recentWorkBlocks"][0]["output"],
        "error reproduced"
    );
}
#[test]
fn proposal_acceptance_is_versioned_and_goal_does_not_replace_step() {
    let (mut s, c, t) = setup(0);
    let bid = current(&s).unwrap().id.clone();
    for kind in ["goal", "step"] {
        let v = json!({"blockId":bid,"taskId":"task","expectedTaskRevision":s.tasks[0].revision,"kind":kind,"text":"read error details","reason":"bounded next action"});
        execute(&mut s, &c, "propose_coaching_action", &v, "hermes", t).unwrap();
        let pid = s.coach.proposals.last().unwrap().id.clone();
        execute(
            &mut s,
            &c,
            "respond_coach_proposal",
            &json!({"proposalId":pid,"response":"accept"}),
            "user",
            t + 100,
        )
        .unwrap();
        if kind == "goal" {
            assert_eq!(s.tasks[0].revision, 1);
            assert_eq!(current(&s).unwrap().goal, "read error details");
        } else {
            assert_eq!(s.tasks[0].revision, 2);
            assert_eq!(
                s.tasks[0].next_action.as_ref().unwrap().text,
                "read error details"
            );
        }
    }
}
#[test]
fn local_observations_expire_and_cannot_be_automatically_reclassified() {
    let (mut s, c, t) = setup(0);
    s.coach.settings.hermes = true; // Simulate an old installation before maintenance.
    sample(&mut s, &c, t, "article");
    let key = s.coach.activities[0].key.clone();
    let mut v = block_input(&s);
    v["key"] = json!(key);
    v["relation"] = json!("related");
    execute(&mut s, &c, "label_activity", &v, "user", t).unwrap();
    let b = current(&s).unwrap();
    let v = json!({"blockId":b.id,"taskId":"task","expectedTaskRevision":1,"kind":"observe","activityKey":key,"relation":"unrelated"});
    assert!(execute(&mut s, &c, "propose_coaching_action", &v, "hermes", t + 100).is_err());
    assert_eq!(current(&s).unwrap().labels[0].relation, "related");
    maintain(&mut s, t + 24 * 60 * MINUTE + 1);
    assert!(s.coach.activities.is_empty());
}

#[test]
fn end_work_event_identifies_the_ended_block_and_feedback() {
    let (mut s, c, t) = setup(0);
    let mut input = block_input(&s);
    input["progress"] = json!("advanced");
    input["output"] = json!("a saved result");
    execute(&mut s, &c, "end_work", &input, "user", t + 1000).unwrap();
    let raw: String = c
        .query_row(
            "SELECT data FROM paper_events ORDER BY seq DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let event: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(event["kind"], "end_work");
    assert_eq!(event["data"]["blockId"], input["blockId"]);
    assert_eq!(event["data"]["block"]["status"], "ended");
    assert_eq!(event["data"]["block"]["progress"], "advanced");
    assert_eq!(event["data"]["block"]["output"], "a saved result");
}

#[test]
fn adopting_with_a_clock_is_atomic_versioned_and_preserves_the_snapshot() {
    let (mut s, mut c, t) = setup(1500);
    let bid = current(&s).unwrap().id.clone();
    execute(&mut s, &c, "propose_coaching_action", &json!({"blockId":bid,"taskId":"task","expectedTaskRevision":1,"kind":"step","text":"new bounded step","reason":"a useful next action"}), "hermes", t).unwrap();
    let pid = s.coach.proposals[0].id.clone();
    c.execute(
        "UPDATE paper_state SET data=?1 WHERE id=1",
        [serde_json::to_string(&s).unwrap()],
    )
    .unwrap();
    let input = json!({"requestId":id(),"proposalId":pid,"response":"accept","finishSessionId":s.sessions[0].id,"expectedSessionRevision":s.sessions[0].revision});
    let mut invalid = input.clone();
    invalid["response"] = json!("edit");
    invalid["text"] = json!("");
    assert!(paper_execute(&mut c, "respond_coach_proposal", invalid, "user").is_err());
    let unchanged = paper_execute(&mut c, "get_state", json!({}), "user")
        .unwrap()
        .0;
    assert_eq!(unchanged["state"]["sessions"][0]["status"], "running");
    assert_eq!(unchanged["state"]["tasks"][0]["revision"], 1);
    let mut stale = input.clone();
    stale["expectedSessionRevision"] = json!(999);
    assert!(paper_execute(&mut c, "respond_coach_proposal", stale, "user").is_err());
    assert!(paper_execute(&mut c, "respond_coach_proposal", input.clone(), "hermes").is_err());
    paper_execute(&mut c, "respond_coach_proposal", input.clone(), "user").unwrap();
    paper_execute(&mut c, "respond_coach_proposal", input, "user").unwrap();
    let result = paper_execute(&mut c, "get_state", json!({}), "user")
        .unwrap()
        .0;
    assert_eq!(result["state"]["sessions"][0]["status"], "finished");
    assert_eq!(
        result["state"]["sessions"][0]["action"]["text"],
        "验证登录流程"
    );
    assert_eq!(
        result["state"]["tasks"][0]["nextAction"]["text"],
        "new bounded step"
    );
    assert_eq!(result["state"]["tasks"][0]["completed"], false);
    let count: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM paper_events WHERE json_extract(data,'$.kind')='finish_session'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn local_observation_is_opt_in_and_automatic_coaching_cannot_be_enabled() {
    assert!(!Settings::default().enabled);
    assert!(!Settings::default().hermes);
    let settings: Settings =
        serde_json::from_value(json!({"enabled":true,"hermes":true,"revision":3})).unwrap();
    let (mut s, c, t) = setup(0);
    s.coach.settings = settings;
    maintain(&mut s, t);
    assert!(s.coach.settings.enabled);
    assert!(!s.coach.settings.hermes);
    assert_eq!(s.coach.settings.revision, 4);
    assert!(execute(
        &mut s,
        &c,
        "coach_settings",
        &json!({"expectedRevision":4,"hermes":true}),
        "user",
        t
    )
    .unwrap_err()
    .starts_with("ON_DEMAND_ONLY"));
    assert!(!s.coach.settings.hermes);
    assert_eq!(s.coach.settings.revision, 4);
}

#[test]
fn runtime_tick_skips_sampling_without_work_or_when_disabled() {
    fn should_not_sample() -> Option<Value> {
        panic!("sampling outside enabled work");
    }
    let mut c = open(std::path::Path::new(":memory:")).unwrap();
    let (_, changed) = crate::paper::runtime_tick(&mut c, should_not_sample).unwrap();
    assert!(!changed);
    assert!(paper_execute(&mut c, "runtime_tick", json!({}), "user").is_err());
    let (mut s, mut c, _) = setup(0);
    s.coach.settings.enabled = false;
    c.execute(
        "UPDATE paper_state SET data=?1",
        [serde_json::to_string(&s).unwrap()],
    )
    .unwrap();
    crate::paper::runtime_tick(&mut c, should_not_sample).unwrap();
}

#[test]
fn runtime_persists_legacy_cancellation_and_keeps_a_single_work_end_notice() {
    let (mut s, mut c, t) = legacy_episode();
    s.coach.settings.hermes = true;
    // Expire this user's clock independently of observation preferences.
    s.coach.blocks[0].planned_end_at = chrono::Utc::now().timestamp_millis() - 1;
    s.coach.blocks[0].mode = "rest".into();
    s.coach.settings.enabled = false;
    c.execute(
        "UPDATE paper_state SET data=?1",
        [serde_json::to_string(&s).unwrap()],
    )
    .unwrap();
    let (result, changed) =
        crate::paper::runtime_tick(&mut c, || panic!("expired work must not sample")).unwrap();
    assert!(changed);
    assert_eq!(result["prompt"]["kind"], "work_end");
    let saved = paper_execute(&mut c, "get_state", json!({}), "user")
        .unwrap()
        .0;
    assert_eq!(saved["state"]["coach"]["settings"]["hermes"], false);
    assert_eq!(
        saved["state"]["coach"]["episodes"][0]["status"],
        "cancelled"
    );
    assert_eq!(saved["state"]["coach"]["episodes"][0]["createdAt"], t);
    let bid = result["prompt"]["block"]["id"].clone();
    paper_execute(
        &mut c,
        "coach_prompt_shown",
        json!({"requestId":id(),"blockId":bid}),
        "user",
    )
    .unwrap();
    let (result, _) =
        crate::paper::runtime_tick(&mut c, || panic!("expired work must not sample")).unwrap();
    assert!(result["prompt"].is_null());
}

#[test]
#[ignore = "explicit historical-load benchmark"]
fn runtime_historical_load_benchmark() {
    fn observed() -> Option<Value> {
        Some(json!({"app":"editor.exe","title":"test document","idleMs":0}))
    }
    let (mut s, mut c, _) = setup(1500);
    let template = s.sessions[0].clone();
    for index in 0..5000 {
        let mut session = template.clone();
        session.id = format!("history-{index}");
        session.status = "finished".into();
        session.last_resumed_at = None;
        s.sessions.push(session);
    }
    c.execute(
        "UPDATE paper_state SET data=?1",
        [serde_json::to_string(&s).unwrap()],
    )
    .unwrap();
    let before = std::time::Instant::now();
    for _ in 0..5 {
        paper_execute(&mut c, "get_state", json!({}), "system").unwrap();
        paper_execute(&mut c, "coach_observe", observed().unwrap(), "system").unwrap();
        paper_execute(&mut c, "get_coach_prompt", json!({}), "system").unwrap();
    }
    let old_ms = before.elapsed().as_millis();
    let before = std::time::Instant::now();
    let mut bytes = 0;
    for _ in 0..5 {
        bytes = crate::paper::runtime_tick(&mut c, observed)
            .unwrap()
            .0
            .to_string()
            .len();
    }
    let new_ms = before.elapsed().as_millis();
    let full = paper_execute(&mut c, "get_state", json!({}), "user")
        .unwrap()
        .0;
    assert_eq!(full["state"]["sessions"].as_array().unwrap().len(), 5001);
    assert!(bytes * 100 < full.to_string().len());
    println!("HISTORY_BENCH sessions=5001 ticks=5 old_ms={old_ms} new_ms={new_ms} runtime_bytes={bytes} full_bytes={}", full.to_string().len());
}

#[test]
fn stopping_an_episode_prevents_retry_without_changing_task() {
    let (mut s, c, t) = legacy_episode();
    let e = s.coach.episodes[0].id.clone();
    execute(
        &mut s,
        &c,
        "respond_coach_prompt",
        &json!({"episodeId":e,"response":"stop"}),
        "user",
        t,
    )
    .unwrap();
    assert!(prompt(&s, t + 300000).is_null());
    assert_eq!(s.coach.episodes[0].status, "resolved");
    assert_eq!(s.tasks[0].revision, 1);
}
