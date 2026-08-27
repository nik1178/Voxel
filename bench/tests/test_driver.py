from bench.driver import chromium_args, presentation_mode


def test_vsync_launch_keeps_browser_presentation_pacing_enabled():
    """Removing either filter must not silently turn a paced campaign uncapped."""
    args = chromium_args(vsync=True)

    assert "--disable-gpu-vsync" not in args
    assert "--disable-frame-rate-limit" not in args
    assert "--force-device-scale-factor=1" in args


def test_default_launch_remains_explicitly_uncapped_for_legacy_campaigns():
    args = chromium_args(vsync=False)

    assert "--disable-gpu-vsync" in args
    assert "--disable-frame-rate-limit" in args


def test_result_metadata_identifies_presentation_mode():
    assert presentation_mode(vsync=True) == {
        "vsync": True,
        "frame_rate_limit": True,
    }
    assert presentation_mode(vsync=False) == {
        "vsync": False,
        "frame_rate_limit": False,
    }


# --- gap campaign (2026-08-23) ---
from bench.driver import viewport_for, check_gpu_vendor, aggregate_js


def test_viewport_for_defaults_and_config():
    assert viewport_for({"renderType": "hybrid"}) == {"width": 1920, "height": 1080}
    assert viewport_for({"viewport": [1280, 720]}) == {"width": 1280, "height": 720}


def test_check_gpu_vendor():
    res = {"provenance": {"adapterInfo": {"vendor": "nvidia"}}}
    assert check_gpu_vendor(res, "nvidia") is None
    assert check_gpu_vendor(res, "any") is None
    assert "intel" in check_gpu_vendor(res, "intel")
    assert check_gpu_vendor({"provenance": None}, "nvidia") is not None


def test_aggregate_js_tolerates_missing():
    assert aggregate_js({"jsFrameTimesMs": [1.0, 2.0, 3.0]})["frames"] == 3
    assert aggregate_js({})["frames"] == 0
