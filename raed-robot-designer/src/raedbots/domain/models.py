from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel as PydanticBaseModel, ConfigDict, Field, field_validator, model_validator


class BaseModel(PydanticBaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")


class CheckStatus(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    UNKNOWN = "unknown"
    NOT_APPLICABLE = "not_applicable"


class DesignState(str, Enum):
    DRAFT = "DRAFT"
    CALCULATED = "CALCULATED"
    ENGINEERING_REVIEW = "ENGINEERING_REVIEW"
    APPROVED_FOR_PROTOTYPE = "APPROVED_FOR_PROTOTYPE"
    APPROVED_FOR_MANUFACTURING = "APPROVED_FOR_MANUFACTURING"
    REJECTED = "REJECTED"


class MakeBuy(str, Enum):
    MAKE = "make"
    BUY = "buy"
    NEEDS_DECISION = "needs_decision"


class Binding(str, Enum):
    FIXED = "fixed"
    FROM_LIST = "from_list"
    AUTO = "auto"


class CadMatch(str, Enum):
    VERIFIED_MATCH = "verified_match"
    STANDARD_DIMS_VERIFIED = "standard_dims_verified"
    ENVELOPE = "envelope"
    MISSING = "missing"
    NOT_APPLICABLE = "not_applicable"


class Quantity(BaseModel):
    value: float
    unit: str
    source: str = "user"
    binding: Binding = Binding.AUTO
    required: bool = True
    notes: str | None = None

    @field_validator("value")
    @classmethod
    def finite(cls, v: float) -> float:
        if v != v or v in (float("inf"), float("-inf")):
            raise ValueError("quantity must be finite")
        return v


class Pose(BaseModel):
    """Homogeneous pose: translation in meters, unit quaternion wxyz."""

    x_m: float
    y_m: float
    z_m: float
    qw: float = 1.0
    qx: float = 0.0
    qy: float = 0.0
    qz: float = 0.0
    frame: str = "world"

    @model_validator(mode="after")
    def unit_quat(self) -> Pose:
        n = (self.qw**2 + self.qx**2 + self.qy**2 + self.qz**2) ** 0.5
        if n < 1e-12:
            raise ValueError("quaternion has zero length")
        object.__setattr__(self, "qw", self.qw / n)
        object.__setattr__(self, "qx", self.qx / n)
        object.__setattr__(self, "qy", self.qy / n)
        object.__setattr__(self, "qz", self.qz / n)
        return self


class InertiaTensor(BaseModel):
    ixx: float
    iyy: float
    izz: float
    ixy: float = 0.0
    ixz: float = 0.0
    iyz: float = 0.0
    point: Literal["com"] = "com"
    frame: str = "link"
    unit: str = "kg.m^2"
    source: str = "estimate_from_cad_density"

    @model_validator(mode="after")
    def physical(self) -> InertiaTensor:
        import numpy as np
        moments = np.linalg.eigvalsh([[self.ixx, self.ixy, self.ixz], [self.ixy, self.iyy, self.iyz], [self.ixz, self.iyz, self.izz]])
        if moments[0] < -1e-10 or moments[2] > moments[0] + moments[1] + 1e-10:
            raise ValueError("inertia must be positive semidefinite and satisfy the triangle inequality")
        return self


class EndEffector(BaseModel):
    id: str
    name: str
    family: Literal["gripper", "welding_torch"]
    manufacturer: str
    model: str
    revision: str = "A"
    mass_kg: float
    mass_includes: str
    com: Pose
    inertia: InertiaTensor
    tcp: Pose
    flange_pattern: str
    adapter_mass_kg: float = 0.0
    cable_od_mm: float | None = None
    min_bend_radius_mm: float | None = None
    power: dict[str, Any] = Field(default_factory=dict)
    process: dict[str, Any] = Field(default_factory=dict)
    collision_box_m: list[float] = Field(default_factory=lambda: [0.12, 0.08, 0.18])
    data_source: str
    license_note: str = "catalog excerpt for internal sizing; CAD may be envelope"


class DhRow(BaseModel):
    a_m: float
    alpha_rad: float
    d_m: float
    theta_offset_rad: float = 0.0
    q_min_rad: float
    q_max_rad: float


class LinkFamily(BaseModel):
    id: str
    name: str
    description: str
    reach_m: float
    dh: list[DhRow]
    section: Literal["box", "tube"]
    width_m: float
    height_m: float
    wall_m: float
    base_size_m: float


class ComponentRecord(BaseModel):
    id: str
    kind: Literal["motor", "gearbox", "bearing", "fastener", "other"]
    manufacturer: str
    model: str
    description: str
    mass_kg: float
    data_source: str
    specs: dict[str, Any] = Field(default_factory=dict)
    cad_status: CadMatch = CadMatch.ENVELOPE
    cad_file: str | None = None
    unit_cost: float | None = None
    currency: str | None = None
    cost_date: str | None = None
    cost_status: Literal["documented", "estimate_unverified", "unknown"] = "unknown"
    egypt_source_status: str = "not_searched_live"


class Material(BaseModel):
    id: str
    name: str
    density_kg_m3: float
    E_Pa: float
    Sy_Pa: float | None
    data_source: str
    process: list[str]


class ProjectRequirements(BaseModel):
    application: str = "pick_and_place"
    process_notes: str = ""
    workpiece_mass_kg: Quantity
    tool_mass_override_kg: Quantity | None = None
    payload_kg: Quantity
    payload_includes_tool: bool | None = None
    reach_m: Quantity
    cycle_time_s: Quantity
    tool_choice: str = "auto"
    locked_tool_id: str | None = None
    dual_tool_mode: Literal["shared_body", "independent"] = "shared_body"
    second_tool_id: str | None = None
    position_accuracy_mm: Quantity
    repeatability_mm: Quantity
    max_robot_mass_kg: Quantity | None = None
    manufacturing_budget: Quantity | None = None
    budget_currency: str = "EGP"
    production_qty: int = Field(default=1, ge=1, le=100000)
    max_output_torque_nm: dict[str, float] | None = None
    tcp_speed_m_s: Quantity | None = None
    materials_allowed: list[str] = Field(default_factory=lambda: ["al6061", "s235"])
    processes_allowed: list[str] = Field(default_factory=lambda: ["cnc", "sheet"])
    locked_material_id: str | None = None
    locked_motor_ids: list[str] = Field(default_factory=list)
    inventory_only: bool = False
    delivery_governorate: str | None = None
    optimization_goal: Literal["balanced", "mass", "cost", "reach", "cycle"] = "balanced"
    environment_notes: str = ""


class Obstacle(BaseModel):
    id: str
    kind: str = "box"
    pose: Pose
    size_m: list[float] = Field(min_length=3, max_length=3)

    @field_validator("size_m")
    @classmethod
    def positive_size(cls, v):
        if any(x <= 0 for x in v):
            raise ValueError("box dimensions must be positive")
        return v


class TaskPose(BaseModel):
    id: str
    pose: Pose
    require_orientation: bool = True


class Workcell(BaseModel):
    size_m: list[float] = Field(default_factory=lambda: [4.0, 4.0, 3.0], min_length=3, max_length=3)
    base_pose: Pose = Field(default_factory=lambda: Pose(x_m=0, y_m=0, z_m=0))
    obstacles: list[Obstacle] = Field(default_factory=list, max_length=100)
    task_poses: list[TaskPose] = Field(default_factory=list, max_length=16)
    path_ids: list[str] = Field(default_factory=list)


class AxisAssignment(BaseModel):
    joint: int
    motor_id: str
    gearbox_id: str
    bearing_id: str
    ratio: float


class RobotConfiguration(BaseModel):
    revision_id: str
    family_id: str
    material_id: str
    process: str
    scale_links: float = 1.0
    wall_scale: float = 1.0
    tool_id: str
    adapter: bool = False
    axes: list[AxisAssignment]
    dh_override: list[DhRow] | None = None
    engine_version: str
    parent_revision: str | None = None
    notes: str = ""


class CheckResult(BaseModel):
    name: str
    status: CheckStatus
    value: Any = None
    unit: str | None = None
    required: Any = None
    method: str
    assumptions: str
    evidence: str
    reasons: list[str] = Field(default_factory=list)


class SolverResult(BaseModel):
    revision_id: str
    engine_version: str
    fk_tcp: Pose | None = None
    joint_torques_gravity_nm: list[float] = Field(default_factory=list)
    joint_speed_limit_rad_s: list[float] = Field(default_factory=list)
    robot_mass_kg: float | None = None
    payload_capacity_kg: float | None = None
    cycle_time_s: float | None = None
    singularity_min_svd: float | None = None
    cad_coverage_unique: float | None = None
    known_cost_egp: float | None = None
    cost_incomplete: bool = True
    checks: list[CheckResult] = Field(default_factory=list)
    feasible: bool = False
    rejected_reasons: list[str] = Field(default_factory=list)
    link_poses: list[list[list[float]]] = Field(default_factory=list)
    rom_points: list[list[float]] = Field(default_factory=list)
    task_reach: list[dict[str, Any]] = Field(default_factory=list)


class BomLine(BaseModel):
    item: int
    parent: str | None
    part_number: str
    revision: str
    description: str
    make_buy: MakeBuy
    qty: float
    unit: str
    material: str | None = None
    manufacturer: str | None = None
    model: str | None = None
    mass_kg: float | None = None
    supplier: str | None = None
    unit_cost: float | None = None
    currency: str | None = None
    cad: str | None = None
    cad_match: CadMatch | None = None
    status: str = "draft"
    notes: str = ""


class ApprovalRecord(BaseModel):
    approval_id: str
    revision_id: str
    purpose: Literal["review", "prototype", "manufacturing"]
    state: DesignState
    timestamp: str
    snapshot_hash: str
    reviewer: str = "user"
    notes: str = ""


class InventoryRow(BaseModel):
    sku: str
    model: str
    qty_available: float = Field(ge=0)
    approved: bool
    updated: str
    source: str
