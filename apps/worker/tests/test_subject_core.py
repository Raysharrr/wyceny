"""Pure-core tests for subject.py — in-code fixtures, zero network (F-9: no PESEL/KW shapes)."""

from app.subject import (
    building_from_xml,
    is_poznan,
    parcel_from_xml,
    parse_geopoz_fields,
    pick_mpzp_function,
    pick_plan,
)

DZIALKA_XML = """<?xml version="1.0"?>
<FeatureInfoResponse>
  <ID_DZIALKI>306401_1.0021.AR_10.161</ID_DZIALKI>
  <NUMER_DZIALKI>161</NUMER_DZIALKI>
  <NUMER_ARKUSZA>10</NUMER_ARKUSZA>
  <NUMER_OBREBU>21</NUMER_OBREBU>
  <NAZWA_OBREBU>JEŻYCE</NAZWA_OBREBU>
  <NAZWA_GMINY>Poznań</NAZWA_GMINY>
  <POLE_EWIDENCYJNE>0.0772</POLE_EWIDENCYJNE>
  <GRUPA_REJESTROWA>7</GRUPA_REJESTROWA>
  <KLASOUZYTKI_EGIB>B</KLASOUZYTKI_EGIB>
</FeatureInfoResponse>"""

BUDYNEK_XML = """<?xml version="1.0"?>
<FeatureInfoResponse>
  <ID_BUDYNKU>306401_1.0021.AR_10.162.1_BUD</ID_BUDYNKU>
  <RODZAJ>budynki mieszkalne</RODZAJ>
  <KONDYGNACJE_NADZIEMNE>6</KONDYGNACJE_NADZIEMNE>
  <KONDYGNACJE_PODZIEMNE>1</KONDYGNACJE_PODZIEMNE>
</FeatureInfoResponse>"""

EMPTY_XML = '<?xml version="1.0"?><FeatureInfoResponse></FeatureInfoResponse>'

PARCEL_WKT = "POLYGON((0 0,10 0,10 10,0 10,0 0))"

FUNCTIONS_GEOJSON = {
    "features": [
        {  # covers the whole parcel -> must win
            "properties": {"FUNKCJA": "4MW/U", "GRUPA": "mieszkalnictwo"},
            "geometry": {"type": "Polygon",
                         "coordinates": [[[-5, -5], [15, -5], [15, 15], [-5, 15], [-5, -5]]]},
        },
        {  # disjoint -> overlap 0
            "properties": {"FUNKCJA": "KD-L", "GRUPA": "komunikacja"},
            "geometry": {"type": "Polygon",
                         "coordinates": [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]},
        },
    ]
}

PLANS_GEOJSON = {
    "features": [
        {
            "properties": {"kod_planu": "Sec", "nazwa": "Testowo - Północ",
                           "uchw_zatw": "VII/84/VIII/2019", "data_zatw": "2019-02-26",
                           "publ_dz_urz": "Rocznik 2019, poz. 2776"},
            "geometry": {"type": "Polygon",
                         "coordinates": [[[16.89, 52.40], [16.92, 52.40], [16.92, 52.43],
                                          [16.89, 52.43], [16.89, 52.40]]]},
        }
    ]
}


def test_parse_geopoz_fields_flat_dump():
    fields = parse_geopoz_fields(DZIALKA_XML)
    assert fields["NUMER_DZIALKI"] == "161"
    assert fields["KLASOUZYTKI_EGIB"] == "B"


def test_parcel_from_xml_maps_fields():
    parcel = parcel_from_xml(DZIALKA_XML)
    assert parcel == {
        "parcel_id": "306401_1.0021.AR_10.161",
        "obreb": "Jeżyce",
        "arkusz": "10",
        "nr_dzialki": "161",
        "pow_ewid_ha": 0.0772,
        "uzytek": "B",
    }


def test_parcel_from_xml_empty_returns_none():
    assert parcel_from_xml(EMPTY_XML) is None


def test_building_from_xml_maps_fields():
    building = building_from_xml(BUDYNEK_XML)
    assert building == {
        "rodzaj": "budynki mieszkalne",
        "kondygnacje_nadziemne": 6,
        "kondygnacje_podziemne": 1,
    }


def test_building_from_xml_empty_returns_none():
    assert building_from_xml(EMPTY_XML) is None


def test_pick_mpzp_function_max_overlap_wins():
    picked = pick_mpzp_function(PARCEL_WKT, FUNCTIONS_GEOJSON)
    assert picked == {"symbol": "4MW/U", "grupa": "mieszkalnictwo"}


def test_pick_mpzp_function_no_features_returns_none():
    assert pick_mpzp_function(PARCEL_WKT, {"features": []}) is None


def test_pick_plan_point_in_polygon():
    plan = pick_plan(16.905, 52.416, PLANS_GEOJSON)
    assert plan == {"nazwa": "Testowo - Północ", "uchwala": "VII/84/VIII/2019",
                    "data": "2019-02-26", "publ": "Rocznik 2019, poz. 2776"}


def test_pick_plan_outside_returns_none():
    assert pick_plan(17.5, 53.0, PLANS_GEOJSON) is None


def test_is_poznan_teryt_prefix():
    assert is_poznan("306401") is True
    assert is_poznan("146501") is False
    assert is_poznan(None) is False
