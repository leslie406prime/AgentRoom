export type AgentJob={id:string;room_id:string;requester_id:string;requester_name:string;prompt:string;idempotency_key:string;status:string;model?:string|null;agent?:string|null;provider?:string|null};
export type ArtifactRow={id:string;title:string;type:string;language:string;content:string;version:number;updated_by:string;updated_at:string};
