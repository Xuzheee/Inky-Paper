//! Capabilities for the on-demand model and the local user click proxy.
pub(crate) fn model_action(action: &str) -> bool {
    matches!(action,
        "list_tasks" | "get_task" | "read_history" | "read_events"
        | "get_coach_context" | "propose_coaching_action" | "propose_plan_batch"
        | "get_plan_batch" | "get_daily_record" | "save_daily_summary"
        | "propose_plan_adjustment" | "get_plan_adjustment")
}
pub(crate) fn user_proxy_action(action: &str) -> bool {
    matches!(action, "get_plan_batch" | "adopt_plan_cards" | "get_plan_adjustment" | "adopt_plan_adjustment")
}
pub(crate) fn authorize(source: &str, action: &str) -> Result<(), String> {
    if source == "user" || model_action(action)
        || (source == "system" && matches!(action, "coach_observe" | "coach_analysis_status")) {
        Ok(())
    } else {
        Err("FORBIDDEN: 此操作仅由本地用户执行；Coach 只能读取事实和提出候选。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn model_and_click_capabilities_do_not_overlap_on_writes() {
        for action in ["create_task","update_task","adopt_plan_cards","adopt_plan_adjustment","revise_plan_adjustment","select_step","prepare_step","workbench_move_item","start_session","pause_session","finish_session","start_work","set_step_completed","runtime_tick"] {
            assert!(!model_action(action),"{action}");
            assert!(authorize("hermes",action).is_err(),"{action}");
            assert!(authorize("agent",action).is_err(),"{action}");
        }
        assert!(user_proxy_action("adopt_plan_cards"));
        assert!(!user_proxy_action("create_task"));
        assert!(!user_proxy_action("start_session"));
    }
    #[test]
    fn denied_model_requests_leave_state_events_and_request_cache_untouched() {
        let mut c=crate::paper::open(std::path::Path::new(":memory:")).unwrap();
        let before=serde_json::to_value(crate::paper::load(&c).unwrap()).unwrap();
        for action in ["create_task","update_task","adopt_plan_cards","adopt_plan_adjustment","start_work","finish_session"] {
            let result=crate::paper::execute(&mut c,action,json!({"requestId":uuid::Uuid::new_v4().to_string()}),"hermes");
            assert!(result.unwrap_err().starts_with("FORBIDDEN:"));
        }
        assert_eq!(serde_json::to_value(crate::paper::load(&c).unwrap()).unwrap(),before);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM paper_requests",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM paper_events",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
}
