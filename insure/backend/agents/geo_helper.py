"""Geographic utilities for bounding box operations and county detection."""

from geopy.geocoders import Nominatim


_geocoder = Nominatim(user_agent="insure-lead-engine")


def get_bounding_box_center(bbox: dict) -> tuple[float, float]:
    """Return (lat, lng) center of a bounding box dict with north/south/east/west."""
    lat = (bbox["north"] + bbox["south"]) / 2
    lng = (bbox["east"] + bbox["west"]) / 2
    return lat, lng


def reverse_geocode_county(lat: float, lng: float) -> str | None:
    """Reverse-geocode a point and extract the Florida county name."""
    try:
        location = _geocoder.reverse((lat, lng), exactly_one=True, language="en")
        if not location or not location.raw:
            return None

        address = location.raw.get("address", {})
        county = address.get("county", "")

        # Strip " County" suffix if present
        if county.endswith(" County"):
            county = county[: -len(" County")]

        state = address.get("state", "")
        if state != "Florida":
            return None

        return county if county else None
    except Exception as e:
        print(f"[geo_helper] Reverse geocode error: {e}")
        return None


def is_within_bounds(lat: float, lng: float, bbox: dict) -> bool:
    """Check if a lat/lng point falls within the bounding box."""
    return (
        bbox["south"] <= lat <= bbox["north"]
        and bbox["west"] <= lng <= bbox["east"]
    )
