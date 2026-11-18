#[test]
fn desktop_policy_allows_embedded_fonts() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let policy = config["app"]["security"]["csp"].as_str().unwrap();
    let font_sources = policy
        .split(';')
        .map(str::trim)
        .find_map(|directive| directive.strip_prefix("font-src "))
        .unwrap_or_else(|| {
            policy
                .split(';')
                .map(str::trim)
                .find_map(|directive| directive.strip_prefix("default-src "))
                .unwrap()
        });
    assert!(
        font_sources
            .split_whitespace()
            .any(|source| source == "data:"),
        "embedded project fonts use data: URLs, but font-src blocks them: {font_sources}"
    );
}
