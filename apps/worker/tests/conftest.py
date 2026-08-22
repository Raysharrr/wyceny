"""Test-wide guards.

The worker's tests are offline by contract (see the module docstrings). `/sample-proposal`
kicks off the GEOPOZ street-index build, which would reach for 13 MB from BIP in every
test that touches the endpoint — so the autostart is disabled here and exercised
explicitly by the tests that mean to (`test_street_index.py`, and the autostart test in
`test_sample_proposal_streets.py`, both with injected I/O).
"""

import pytest

from app import street_index


@pytest.fixture(autouse=True)
def no_street_index_download(monkeypatch):
    monkeypatch.setattr(street_index, "ensure_started", lambda *args, **kwargs: None)
