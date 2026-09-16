use super::*;
use crate::{paper, paper_markdown, paper_planning};
use std::{fs, path::PathBuf};

const DATE: &str = "2020-03-04";
const AT: i64 = 1_583_287_200_000; // 2020-03-04 12:00 UTC, 20:00 +08.
const TASK: &str = "00000000-0000-4000-8000-000000000001";
const STEP: &str = "00000000-0000-4000-8000-000000000002";
const ITEM: &str = "00000000-0000-4000-8000-000000000003";
const SESSION: &str = "00000000-0000-4000-8000-000000000004";
const MANUAL: &str = "00000000-0000-4000-8000-000000000005";
const NOTE: &str = "00000000-0000-4000-8000-000000000006";
const CHANGE: &str = "00000000-0000-4000-8000-000000000007";

fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn fixture() -> PaperState {
    serde_json::from_value(json!({
        "tasks":[{"id":TASK,"title":"当前任务","due":null,"completed":false,"nextAction":{"id":STEP,"text":"当前步骤","completed":false,"source":"user"},"revision":1,"source":"user","createdAt":AT,"updatedAt":AT,"completedAt":null}],
        "sessions":[{"id":SESSION,"taskId":TASK,"taskTitle":"执行时任务","action":{"id":STEP,"text":"执行时步骤","completed":false,"source":"user"},"taskRevision":1,"kind":"focus","status":"finished","revision":2,"plannedSeconds":1500,"elapsedSeconds":60,"startedAt":AT,"lastResumedAt":null,"endedAt":AT+60000,"pauseCount":0,"resumeCue":null,"feedback":null}],
        "notes":[{"id":NOTE,"text":"原随手记","sessionId":SESSION,"createdAt":AT+30000}],
        "planning":{
            "steps":[{"id":STEP,"taskId":TASK,"text":"当前步骤","expectedResult":"一个结果","plannedSeconds":1500,"completed":false,"revision":1,"source":"user","createdAt":AT,"updatedAt":AT}],
            "dayItems":[{"id":ITEM,"date":DATE,"taskId":TASK,"stepId":STEP,"order":0,"revision":1,"removedAt":null,"startMinute":null,"durationMinutes":null}],
            "intervals":[{"sessionId":SESSION,"startedAt":AT,"endedAt":AT+60000}],
            "sessionLinks":[{"sessionId":SESSION,"dayItemId":ITEM,"planDate":DATE}],
            "manualStepChanges":[{"id":MANUAL,"taskId":TASK,"taskTitle":"手动时任务","stepId":STEP,"stepText":"手动时步骤","completed":true,"recordedAt":AT+70000}],
            "planChanges":[{"id":CHANGE,"operation":"add_day_plan_item","source":"user","recordedAt":AT,"before":null,"after":{"id":ITEM,"date":DATE,"taskId":TASK,"stepId":STEP,"order":0,"revision":1,"removedAt":null}}]
        }
    })).unwrap()
}
fn db() -> Connection {
    let c = paper::open(std::path::Path::new(":memory:")).unwrap();
    persist(&c, &fixture());
    c
}
fn persist(c: &Connection, s: &PaperState) {
    c.execute(
        "UPDATE paper_state SET data=?1 WHERE id=1",
        [serde_json::to_string(s).unwrap()],
    )
    .unwrap();
}
fn day(c: &mut Connection) -> Value {
    paper::execute(
        c,
        "get_daily_record",
        json!({"date":DATE,"utcOffsetMinutes":480}),
        "hermes",
    )
    .unwrap()
    .0
}
fn payload(day: &Value, refs: Value) -> Value {
    json!({"requestId":id(),"date":day["date"],"utcOffsetMinutes":day["utcOffsetMinutes"],"expectedDataVersion":day["dataVersion"],"expectedNotesVersion":day["notesVersion"],"sourceAsOf":day["sampledAt"],"body":"仅记录真实发生的工作；未记录的产出未知。","evidenceRefs":refs})
}
fn all_refs() -> Value {
    json!([{"kind":"session","id":SESSION},{"kind":"step","id":STEP},{"kind":"manualChange","id":MANUAL},{"kind":"note","id":NOTE},{"kind":"planChange","id":CHANGE}])
}
fn summary(c: &mut Connection, v: Value) -> Result<Value, String> {
    paper::execute(c, "save_daily_summary", v, "hermes").map(|result| result.0["summary"].clone())
}
fn counts(c: &Connection) -> (i64, i64) {
    (
        c.query_row("SELECT COUNT(*) FROM paper_events", [], |r| r.get(0))
            .unwrap(),
        c.query_row("SELECT COUNT(*) FROM paper_requests", [], |r| r.get(0))
            .unwrap(),
    )
}
struct TempRoot(PathBuf);
impl TempRoot {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("inky-paper-summary-evidence-test-{}", id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn db(&self) -> Connection {
        let c = paper::open(&self.0.join("paper.sqlite3")).unwrap();
        persist(&c, &fixture());
        c
    }
    fn note(&self) -> PathBuf {
        self.0
            .join("工作记录")
            .join("每日")
            .join(format!("{DATE}.个人笔记.md"))
    }
    fn write_note(&self, text: &str) {
        let path = self.note();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
}
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn real_read_saves_server_snapshots_without_touching_execution_and_exact_retry() {
    let mut c = db();
    let d = day(&mut c);
    let mut input = payload(&d, all_refs());
    input["nextStart"] = json!({"taskId":TASK,"stepId":STEP,"dayItemId":ITEM,"cue":"先核对证据"});
    let before = paper::load(&c).unwrap();
    let first = summary(&mut c, input.clone()).unwrap();
    assert_eq!(first["evidence"][0]["snapshot"]["taskTitle"], "执行时任务");
    assert_eq!(
        first["evidence"][0]["snapshot"]["action"]["text"],
        "执行时步骤"
    );
    assert_eq!(first["evidence"][0]["snapshot"]["dailySeconds"], 60);
    assert_eq!(first["evidence"][0]["snapshot"]["clockElapsedSeconds"], 60);
    assert_eq!(first["evidence"][1]["snapshot"]["text"], "当前步骤");
    assert_eq!(first["evidence"][2]["snapshot"]["stepText"], "手动时步骤");
    assert_eq!(first["evidence"][3]["snapshot"]["text"], "原随手记");
    assert_eq!(
        first["evidence"][4]["snapshot"]["operation"],
        "add_day_plan_item"
    );
    let after = paper::load(&c).unwrap();
    assert_eq!(json!(before.tasks), json!(after.tasks));
    assert_eq!(json!(before.sessions), json!(after.sessions));
    assert_eq!(json!(before.planning.steps), json!(after.planning.steps));
    assert_eq!(
        json!(before.planning.prepared),
        json!(after.planning.prepared)
    );
    let before_retry = counts(&c);
    c.execute("DELETE FROM temp.paper_summary_reads", [])
        .unwrap();
    assert_eq!(summary(&mut c, input.clone()).unwrap(), first);
    assert_eq!(counts(&c), before_retry);
    input["body"] = json!("不同正文");
    assert!(summary(&mut c, input)
        .unwrap_err()
        .starts_with("REQUEST_ID_REUSED"));
}

#[test]
fn reads_register_metadata_without_mutating_domain_state_or_events() {
    let c = db();
    let s = paper::load(&c).unwrap();
    let before = counts(&c);
    let mut d = paper_planning::daily_record(&s, DATE, 480, AT + 100000).unwrap();
    paper_markdown::enrich_day(&c, &mut d).unwrap();
    assert_eq!(counts(&c), before);
    assert_eq!(json!(paper::load(&c).unwrap()), json!(s));
    let schema: String = c
        .query_row(
            "SELECT sql FROM sqlite_temp_master WHERE name='paper_summary_reads'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!schema.contains("body"));
    assert!(!schema.contains("quote"));
    assert_eq!(
        c.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='paper_summary_reads'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    for i in 0..4100 {
        d["sampledAt"] = json!(AT + i);
        register_read(&c, &d).unwrap();
    }
    assert_eq!(
        c.query_row("SELECT COUNT(*) FROM temp.paper_summary_reads", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        4096
    );
    assert!(prepare(&c, &payload(&d, json!([])), "hermes").is_ok());
    d["sampledAt"] = json!(AT);
    assert!(prepare(&c, &payload(&d, json!([])), "hermes").is_err());
}

#[test]
fn receipt_requires_exact_date_offset_versions_and_sampled_time() {
    let mut c = db();
    let d = day(&mut c);
    let original = payload(&d, json!([]));
    for (key, value) in [
        ("date", json!("2020-03-05")),
        ("utcOffsetMinutes", json!(0)),
        ("expectedDataVersion", json!("fake")),
        ("expectedNotesVersion", json!("fake")),
        ("sourceAsOf", json!(d["sampledAt"].as_i64().unwrap() - 1)),
    ] {
        let mut input = original.clone();
        input[key] = value;
        assert!(
            summary(&mut c, input).unwrap_err().starts_with("CONFLICT"),
            "{key}"
        );
    }
    assert!(paper::load(&c).unwrap().planning.summaries.is_empty());
}

#[test]
fn invalid_references_and_caller_supplied_snapshots_are_atomic() {
    let mut c = db();
    let d = day(&mut c);
    let before = counts(&c);
    for refs in [
        json!([{"kind":"session","id":"elsewhere"}]),
        json!([{"kind":"unknown","id":STEP}]),
        json!([{"kind":"step","id":STEP},{"kind":"step","id":STEP}]),
        json!([{"kind":"session","id":SESSION,"snapshot":{"taskTitle":"伪造"}}]),
        json!([{"kind":"session","id":SESSION,"label":"伪造"}]),
        json!([{"kind":"note","id":NOTE,"quote":null}]),
        Value::Array(
            (0..25)
                .map(|i| json!({"kind":"note","id":format!("n-{i}")}))
                .collect(),
        ),
    ] {
        assert!(summary(&mut c, payload(&d, refs))
            .unwrap_err()
            .starts_with("INVALID_INPUT"));
    }
    let mut forged = payload(&d, json!([]));
    forged["trustedNotes"] = json!("伪造");
    assert!(summary(&mut c, forged)
        .unwrap_err()
        .contains("unknown field"));
    assert_eq!(counts(&c), before);
    assert!(paper::load(&c).unwrap().planning.summaries.is_empty());
}

#[test]
fn current_step_evidence_requires_a_current_plan_even_if_history_mentions_it() {
    let mut c = db();
    let mut s = paper::load(&c).unwrap();
    s.planning.day_items[0].removed_at = Some(AT + 200000);
    persist(&c, &s);
    let d = day(&mut c);
    assert!(
        summary(&mut c, payload(&d, json!([{"kind":"step","id":STEP}])))
            .unwrap_err()
            .contains("planned steps")
    );
    assert!(summary(
        &mut c,
        payload(
            &d,
            json!([{"kind":"session","id":SESSION},{"kind":"manualChange","id":MANUAL}])
        )
    )
    .is_ok());
}

#[test]
fn current_data_edits_conflict_and_do_not_rewrite_saved_history() {
    let mut c = db();
    let d = day(&mut c);
    let first = summary(&mut c, payload(&d, all_refs())).unwrap();
    let mut s = paper::load(&c).unwrap();
    s.tasks[0].title = "后来改名".into();
    s.tasks[0].revision += 1;
    persist(&c, &s);
    assert!(summary(&mut c, payload(&d, all_refs()))
        .unwrap_err()
        .starts_with("CONFLICT"));
    assert_eq!(json!(paper::load(&c).unwrap().planning.summaries[0]), first);
}

#[test]
fn running_seconds_use_the_original_read_sample_not_save_time() {
    let c = db();
    let mut s = fixture();
    s.sessions[0].status = "running".into();
    s.sessions[0].elapsed_seconds = 0;
    s.sessions[0].last_resumed_at = Some(AT);
    s.sessions[0].ended_at = None;
    s.planning.intervals[0].ended_at = None;
    let mut d = paper_planning::daily_record(&s, DATE, 480, AT + 10000).unwrap();
    paper_markdown::enrich_day(&c, &mut d).unwrap();
    let later = paper_planning::daily_record(&s, DATE, 480, AT + 40000).unwrap();
    assert_eq!(d["dataVersion"], later["dataVersion"]);
    assert_eq!(later["sessions"][0]["dailySeconds"], 40);
    let v = payload(&d, json!([{"kind":"session","id":SESSION}]));
    let trusted = prepare(&c, &v, "hermes").unwrap();
    let result = save(&mut s, &v, "hermes", AT + 40000, Some(&trusted)).unwrap();
    assert_eq!(
        result["summary"]["evidence"][0]["snapshot"]["dailySeconds"],
        10
    );
    assert_eq!(
        result["summary"]["evidence"][0]["snapshot"]["clockElapsedSeconds"],
        10
    );
    assert_eq!(s.sessions[0].status, "running");
    assert_eq!(s.sessions[0].elapsed_seconds, 0);
}

#[test]
fn personal_quotes_only_match_original_bodies_and_allow_distinct_quotes() {
    let root = TempRoot::new();
    let mut c = root.db();
    root.write_note("# 手写复盘\n第一条真实反馈。\n第二条真实反馈。\n");
    let d = day(&mut c);
    let refs = json!([{"kind":"personalNote","id":DATE,"quote":"第一条真实反馈。"},{"kind":"personalNote","id":DATE,"quote":"第二条真实反馈。"}]);
    let saved = summary(&mut c, payload(&d, refs)).unwrap();
    assert_eq!(saved["evidence"].as_array().unwrap().len(), 2);
    assert_eq!(
        saved["evidence"][0]["snapshot"]["quote"],
        "第一条真实反馈。"
    );
    assert!(saved["evidence"][0]["snapshot"].get("body").is_none());
    for refs in [
        json!([{"kind":"personalNote","id":DATE,"quote":format!("## {DATE}.个人笔记.md")}]),
        json!([{"kind":"personalNote","id":"2020-03-05","quote":"第一条真实反馈。"}]),
        json!([{"kind":"personalNote","id":DATE}]),
        json!([{"kind":"personalNote","id":DATE,"quote":""}]),
        json!([{"kind":"personalNote","id":DATE,"quote":"字".repeat(2001)}]),
        json!([{"kind":"personalNote","id":DATE,"quote":"第一条真实反馈。"},{"kind":"personalNote","id":DATE,"quote":"第一条真实反馈。"}]),
    ] {
        assert!(summary(&mut c, payload(&d, refs))
            .unwrap_err()
            .starts_with("INVALID_INPUT"));
    }
}

#[test]
fn personal_notes_version_checked_before_save_and_again_before_commit() {
    let root = TempRoot::new();
    let mut c = root.db();
    root.write_note("最初原文");
    let d = day(&mut c);
    let v = payload(
        &d,
        json!([{"kind":"personalNote","id":DATE,"quote":"最初原文"}]),
    );
    let trusted = prepare(&c, &v, "hermes").unwrap();
    root.write_note("外部修改原文");
    assert!(trusted
        .recheck_notes(&c)
        .unwrap_err()
        .starts_with("CONFLICT"));
    assert!(summary(&mut c, v).unwrap_err().starts_with("CONFLICT"));
    assert!(paper::load(&c).unwrap().planning.summaries.is_empty());
}

#[test]
fn exact_request_retry_survives_changed_notes_and_connection_restart() {
    let root = TempRoot::new();
    let mut c = root.db();
    root.write_note("保存时原文");
    let d = day(&mut c);
    let v = payload(
        &d,
        json!([{"kind":"personalNote","id":DATE,"quote":"保存时原文"}]),
    );
    let first = summary(&mut c, v.clone()).unwrap();
    root.write_note("笔记此后已修改");
    drop(c);
    let mut reopened = paper::open(&root.0.join("paper.sqlite3")).unwrap();
    assert_eq!(summary(&mut reopened, v.clone()).unwrap(), first);
    let mut changed = v.clone();
    changed["body"] = json!("不一样");
    assert!(summary(&mut reopened, changed)
        .unwrap_err()
        .starts_with("REQUEST_ID_REUSED"));
    let mut fresh = v;
    fresh["requestId"] = json!(id());
    assert!(summary(&mut reopened, fresh)
        .unwrap_err()
        .starts_with("CONFLICT"));
    assert_eq!(paper::load(&reopened).unwrap().planning.summaries.len(), 1);
}

#[test]
fn new_request_after_restart_requires_another_genuine_read_even_with_unchanged_notes() {
    let root = TempRoot::new();
    let mut c = root.db();
    let d = day(&mut c);
    let input = payload(&d, json!([]));
    drop(c);
    let mut reopened = paper::open(&root.0.join("paper.sqlite3")).unwrap();
    assert!(summary(&mut reopened, input).unwrap_err().contains("凭据"));
    let fresh_day = day(&mut reopened);
    assert!(summary(&mut reopened, payload(&fresh_day, json!([]))).is_ok());
}

#[test]
fn next_start_requires_matching_scoped_objects_and_cannot_prepare() {
    let mut c = db();
    let d = day(&mut c);
    for next in [
        json!({"taskId":TASK,"stepId":STEP,"dayItemId":id(),"cue":null}),
        json!({"taskId":id(),"stepId":STEP,"dayItemId":null,"cue":null}),
        json!({"taskId":TASK,"stepId":STEP,"dayItemId":null,"cue":null,"prepare":true}),
    ] {
        let mut input = payload(&d, json!([]));
        input["nextStart"] = next;
        assert!(summary(&mut c, input)
            .unwrap_err()
            .starts_with("INVALID_INPUT"));
    }
    let mut s = paper::load(&c).unwrap();
    s.planning.day_items.clear();
    s.planning.session_links.clear();
    s.sessions.clear();
    s.planning.manual_step_changes.clear();
    s.planning.plan_changes.clear();
    persist(&c, &s);
    let d = day(&mut c);
    let mut input = payload(&d, json!([]));
    input["nextStart"] = json!({"taskId":TASK,"stepId":STEP,"dayItemId":null,"cue":null});
    assert!(summary(&mut c, input)
        .unwrap_err()
        .contains("outside this day's"));
    assert!(paper::load(&c).unwrap().planning.prepared.is_none());
}

#[test]
fn completed_step_may_be_saved_as_a_reference_but_preparation_still_rejects_it() {
    let mut c = db();
    let mut s = fixture();
    s.planning.steps[0].completed = true;
    s.tasks[0].next_action.as_mut().unwrap().completed = true;
    persist(&c, &s);
    let d = day(&mut c);
    let mut input = payload(&d, json!([]));
    input["nextStart"] = json!({"taskId":TASK,"stepId":STEP,"dayItemId":ITEM,"cue":null});
    summary(&mut c, input).unwrap();
    assert!(paper::execute(&mut c,"prepare_step",json!({"requestId":id(),"taskId":TASK,"stepId":STEP,"expectedRevision":1,"expectedStepRevision":1,"dayItemId":ITEM}),"user").unwrap_err().contains("COMPLETED"));
    assert!(paper::load(&c).unwrap().planning.prepared.is_none());
}

#[test]
fn legacy_user_calls_and_old_serialized_summaries_remain_readable() {
    let mut c = db();
    let d = day(&mut c);
    let mut v = payload(&d, json!([]));
    v.as_object_mut().unwrap().remove("evidenceRefs");
    assert!(summary(&mut c, v.clone())
        .unwrap_err()
        .contains("evidenceRefs"));
    let result = paper::execute(&mut c, "save_daily_summary", v, "user")
        .unwrap()
        .0;
    assert_eq!(result["summary"]["evidence"], json!([]));
    assert!(result["summary"]["nextStart"].is_null());
    let mut old = result["summary"].clone();
    old.as_object_mut().unwrap().remove("evidence");
    old.as_object_mut().unwrap().remove("nextStart");
    let parsed: Summary = serde_json::from_value(old).unwrap();
    assert!(parsed.evidence.is_empty());
    assert!(parsed.next_start.is_none());
}

#[test]
fn continuing_an_old_arrangement_blocks_its_summary_shortcut_but_keeps_history() {
    let mut c = db();
    let d = day(&mut c);
    let mut v = payload(&d, all_refs());
    v["nextStart"] = json!({"taskId":TASK,"stepId":STEP,"dayItemId":ITEM,"cue":null});
    let saved = summary(&mut c, v).unwrap();
    let target = paper::execute(
        &mut c,
        "continue_plan_items",
        json!({
            "requestId":id(),"taskId":TASK,"stepId":STEP,"expectedTaskRevision":1,
            "expectedStepRevision":1,"items":[{"id":ITEM,"revision":1}],"date":"2020-03-05"
        }),
        "user",
    )
    .unwrap()
    .0;
    let before = paper::load(&c).unwrap();
    let before_counts = counts(&c);
    let mut prepare = json!({"requestId":id(),"taskId":TASK,"stepId":STEP,"expectedRevision":1,
        "expectedStepRevision":1,"dayItemId":ITEM});
    let failure = paper::execute(&mut c, "prepare_step", prepare.clone(), "user").unwrap_err();
    assert!(failure.starts_with("CONFLICT"));
    assert!(failure.contains("继续到别日"));
    assert_eq!(json!(paper::load(&c).unwrap()), json!(before));
    assert_eq!(counts(&c), before_counts);
    assert_eq!(json!(before.planning.summaries[0]), saved);
    assert_eq!(before.planning.session_links[0].day_item_id, ITEM);
    prepare["requestId"] = json!(id());
    prepare["dayItemId"] = target["item"]["id"].clone();
    paper::execute(&mut c, "prepare_step", prepare, "user").unwrap();
    let after = paper::load(&c).unwrap();
    assert_eq!(json!(after.sessions), json!(before.sessions));
    assert_eq!(
        json!(after.planning.prepared.unwrap().day_item_id),
        target["item"]["id"]
    );
}

#[test]
fn markdown_exports_saved_evidence_and_suggestion_without_backfilling_old_summaries() {
    let root = TempRoot::new();
    let mut c = root.db();
    root.write_note("真实个人原句");
    let d = day(&mut c);
    let mut refs = all_refs();
    refs.as_array_mut()
        .unwrap()
        .push(json!({"kind":"personalNote","id":DATE,"quote":"真实个人原句"}));
    let mut v = payload(&d, refs);
    v["nextStart"] = json!({"taskId":TASK,"stepId":STEP,"dayItemId":ITEM,"cue":"重新核对"});
    summary(&mut c, v).unwrap();
    let mut s = paper::load(&c).unwrap();
    s.tasks[0].title = "后来任务标题".into();
    persist(&c, &s);
    paper_markdown::sync(&c, true);
    let md = fs::read_to_string(
        root.0
            .join("工作记录")
            .join("每日")
            .join(format!("{DATE}.md")),
    )
    .unwrap();
    for expected in [
        "记录截至：",
        "保存时的快照",
        "执行时任务",
        "执行时步骤",
        "原随手记",
        "真实个人原句",
        "本日计时：60秒",
        "仅建议，未准备或启动",
        SESSION,
        STEP,
    ] {
        assert!(md.contains(expected), "{expected}");
    }
    let d = day(&mut c);
    let mut old = payload(&d, json!([]));
    old.as_object_mut().unwrap().remove("evidenceRefs");
    paper::execute(&mut c, "save_daily_summary", old, "user").unwrap();
    let md = fs::read_to_string(
        root.0
            .join("工作记录")
            .join("每日")
            .join(format!("{DATE}.md")),
    )
    .unwrap();
    assert!(md.contains("这份总结未附依据；旧总结不会补造来源。"));
}
