"""Constants for DayMill."""

from __future__ import annotations

from datetime import timedelta
from typing import Final

DOMAIN: Final = "daymill"
VERSION: Final = "0.1.2"
NAME: Final = "DayMill"
DEVICE_NAME: Final = "DayMill"

PLATFORMS: Final = ["binary_sensor", "sensor"]

# ---- config keys ----
CONF_TARIFF = "tariff"
CONF_NEM = "nem"
CONF_CYCLE_DAY = "cycle_day"
CONF_MAX_AGE = "max_age"
CONF_METERING_LAG = "metering_lag"  # minutes

# power sources
CONF_SOLAR_POWER = "solar_power"
CONF_SOLAR_POWER_FALLBACK = "solar_power_fallback"
CONF_GRID_POWER = "grid_power"
CONF_GRID_POWER_FALLBACK = "grid_power_fallback"
CONF_GRID_POSITIVE_IS_IMPORT = "grid_positive_is_import"
CONF_HOME_POWER = "home_power"

# lifetime energy counters
CONF_SOLAR_ENERGY = "solar_energy"
CONF_IMPORT_ENERGY = "import_energy"
CONF_EXPORT_ENERGY = "export_energy"

CONF_GATEWAY = "gateway_uptime"
# extra gateway sensors shown on the panels view (list of entity ids)
CONF_GATEWAY_DIAGNOSTICS = "gateway_diagnostics"

# where the numbers come from: real entities or the built-in simulator
CONF_SOURCE = "source"
SOURCE_ENTITIES: Final = "entities"
SOURCE_DEMO: Final = "demo"
# which detected system filled the roles ("sunstrong_pvs", "enphase_envoy"...,
# or "custom"); only used to prefill the forms again later
CONF_SYSTEM = "system"
SYSTEM_CUSTOM: Final = "custom"

# False: no money entities, only power, energy and TOU
CONF_TRACK_COST = "track_cost"
# sensor keys left out when cost tracking is off
MONEY_KEYS: Final = (
    "import_energy_charge",
    "export_credit",
    "nbc_charges",
    "adder_charges",
    "import_cost",
    "net_cost",
    "solar_savings",
    "cost_rate",
    "cost_today",
    "bill_estimate",
)

# NEM 3.0 settings (second form step)
CONF_PTO_DATE = "pto_date"
CONF_ACC_PLUS_CLASS = "acc_plus_class"
CONF_ARECR = "arecr"
CONF_NSC_OPT_IN = "nsc_opt_in"
CONF_NSC_RATE = "nsc_rate"
NEM3_KEYS: Final = (CONF_PTO_DATE, CONF_ACC_PLUS_CLASS, CONF_ARECR, CONF_NSC_OPT_IN, CONF_NSC_RATE)
ACC_PLUS_OPTIONS: Final = ["residential", "residential_equity", "none"]

# panels: [{"label": "Front", "facing": "South",
#           "panels": [{"power": entity, "lifetime": entity, "last_reported": entity}]}]
CONF_PANELS = "panels"
CONF_PANEL_LABEL = "label"
CONF_PANEL_FACING = "facing"
CONF_PANEL_LIST = "panels"
CONF_PANEL_POWER = "power"
CONF_PANEL_LIFETIME = "lifetime"
CONF_PANEL_LAST_REPORTED = "last_reported"
CONF_PANEL_NAME = "name"
MAX_ROOF_FACES: Final = 8

CONF_BATTERY_SOC = "battery_soc"
CONF_BATTERY_POWER = "battery_power"
CONF_BATTERY_POSITIVE_IS_DISCHARGE = "battery_positive_is_discharge"

# cars: [{"name": str, "image": "sedan", "device": device id,
#         "presence", "charging", "power", "battery", "plugged", "limit": entity}]
CONF_CARS = "cars"
CONF_CAR_NAME = "name"
CONF_CAR_IMAGE = "image"
CONF_CAR_DEVICE = "device"
CONF_CAR_CHARGING = "charging"
CONF_CAR_PRESENCE = "presence"
CONF_CAR_POWER = "power"
CONF_CAR_BATTERY = "battery"
CONF_CAR_PLUGGED = "plugged"
CONF_CAR_LIMIT = "limit"
CAR_ROLES: Final = (
    CONF_CAR_PRESENCE,
    CONF_CAR_CHARGING,
    CONF_CAR_POWER,
    CONF_CAR_BATTERY,
    CONF_CAR_PLUGGED,
    CONF_CAR_LIMIT,
)
CAR_IMAGES: Final = ["sedan", "suv", "truck"]

# ---- defaults ----
DEFAULT_TARIFF = "sce_tou_d_prime"
DEFAULT_NEM = "nem2"
DEFAULT_CYCLE_DAY = 1
DEFAULT_MAX_AGE = 600
DEFAULT_METERING_LAG = 3
DEFAULT_GRID_POSITIVE_IS_IMPORT = True
DEFAULT_BATTERY_POSITIVE_IS_DISCHARGE = True
DEFAULT_ACC_PLUS_CLASS = "residential"
DEFAULT_SOURCE = SOURCE_ENTITIES
DEFAULT_TRACK_COST = True
DEFAULT_CAR_IMAGE = "sedan"

NEM_OPTIONS: Final = ["nem2", "nem3", "nem1", "none"]

# ---- storage / timing ----
STORAGE_VERSION = 1
STORAGE_SAVE_DELAY = 30  # seconds
TOTALS_INTERVAL = timedelta(minutes=5)
SUN_ENTITY = "sun.sun"

# Recorder totals: metric name -> entity key whose statistics it reads.
TOTALS_METRICS: Final = {
    "produced": "energy_produced",
    "used": "energy_consumed",
    "imported": "energy_imported",
    "exported": "energy_exported",
    "net_cost": "net_cost",
    "nbc": "nbc_charges",
    "adders": "adder_charges",
    "savings": "solar_savings",
}
TOTALS_WINDOWS: Final = ("today", "d7", "d30", "month", "year")
