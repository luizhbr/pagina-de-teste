/**
 * Next Finish Carpentry | optional shared-cloud adapter.
 * NEVER replaces localStorage on construction or login.
 * Requires a dedicated Supabase project, RLS migration and invite-only membership.
 * Not loaded by agenda/index.html until the owner approves activation.
 */
export const NFC_LOCAL_KEY = 'agenda-nfc-public-v1';
export const NFC_BATCH_SIZE = 100;
const recordObject = x => x && typeof x === 'object' && !Array.isArray(x);
const stable = value => JSON.stringify(value, function(key,v) {
  if(recordObject(v)) return Object.keys(v).sort().reduce((o,k) => (o[k]=v[k],o),{});
  return v;
});
const normalizedName = str => String(str||'').trim().toLocaleLowerCase('pt-BR');

export function readLocalSnapshot(storage) {
  function parse(key,fallback) {
    const raw=storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  }
  const items=parse(NFC_LOCAL_KEY, []);
  const clients=parse(NFC_LOCAL_KEY+'-c', {});
  if(!Array.isArray(items) || !recordObject(clients))throw new Error('O backup local possui formato inesperado.');
  // This adapter does not change or re-save the existing user's data.
  const clonedItems=JSON.parse(JSON.stringify(items));
  const clonedClients=JSON.parse(JSON.stringify(clients));
  return {items:clonedItems,clients:clonedClients};
}

export function compareSnapshots(local,remoteEvents,remoteClients) {
  const eventMap=new Map(remoteEvents.map(row=>[row.id,row]));
  const clientMap=new Map(remoteClients.map(row=>[row.name_key,row]));
  const toUploadEvents=[],toUploadClients=[],conflicts=[];
  const seenEventIds=new Set();
  for(const e of local.items){
    if(!recordObject(e)||typeof e.id!=='string'||!e.id||e.id.length>128||typeof e.data!=='string')
      throw new Error('Há compromissos locais inválidos. Revise o backup antes de importar.');
    if(seenEventIds.has(e.id))throw new Error('Existem IDs duplicados no backup local.');
    seenEventIds.add(e.id);
    const remote=eventMap.get(e.id);
    if(!remote)toUploadEvents.push(e);
    else if(stable(e)!==stable(remote.payload))conflicts.push({type:'event',id:e.id});
  }
  for(const [rawKey,customer] of Object.entries(local.clients)){
    if(!recordObject(customer)||!customer.nome)continue;
    const key=normalizedName(customer.nome||rawKey);
    if(!key||key.length>256)throw new Error('Há um nome de cliente inválido.');
    const remote=clientMap.get(key);
    if(!remote)toUploadClients.push({name_key:key,payload:customer});
    else if(stable(customer)!==stable(remote.payload))conflicts.push({type:'client',id:key});
  }
  return {
    localEventCount:local.items.length,remoteEventCount:remoteEvents.length,
    localClientCount:Object.keys(local.clients).length,remoteClientCount:remoteClients.length,
    toUploadEvents,toUploadClients,conflicts
  };
}

export class NFCSharedSync {
  constructor({supabase,teamId}) {
    if(!supabase||!teamId)throw new Error('É necessário conectar um projeto e uma equipe.');
    this.supabase=supabase;
    this.teamId=teamId;
  }
  async verifyMembership(){
    const {data:{user},error:authError}=await this.supabase.auth.getUser();
    if(authError||!user)throw new Error('Faça login antes de sincronizar a agenda.');
    const {data,error}=await this.supabase.from('nfc_team_members')
      .select('team_id,role').eq('team_id',this.teamId).eq('user_id',user.id).maybeSingle();
    if(error||!data)throw new Error('Acesso à agenda não autorizado. Solicite convite ao administrador.');
    return {id:user.id,role:data.role};
  }
  async allRows(table,fields){
    const rows=[];let from=0;
    while(true){
      const {data,error}=await this.supabase.from(table).select(fields)
        .eq('team_id',this.teamId).range(from,from+999);
      if(error)throw error;
      rows.push(...(data||[]));
      if(!data||data.length<1000)return rows;
      from+=data.length;
      if(from>100000)throw new Error('A agenda ultrapassou o limite de paginação.');
    }
  }
  async previewLocalImport(local){
    await this.verifyMembership();
    const [events,clients]=await Promise.all([
      this.allRows('nfc_agenda_events','id,payload,revision,updated_at'),
      this.allRows('nfc_agenda_clients','name_key,payload,revision,updated_at')
    ]);
    return compareSnapshots(local,events,clients);
  }
  /**
   * Import only items that do not exist remotely, NEVER upsert existing records.
   * Any conflict aborts before writes. A network failure may partially import,
   * but retry is safe because already imported items compare as equal.
   * Show/download a backup BEFORE calling this function.
   */
  async importMissing(local) {
    const plan=await this.previewLocalImport(local);
    if(plan.conflicts.length) {
      const err=new Error('Foram encontrados conflitos. Nenhum dado existente foi substituído.');
      err.conflicts=plan.conflicts;
      throw err;
    }
    for(let i=0;i<plan.toUploadEvents.length;i+=NFC_BATCH_SIZE){
      const batch=plan.toUploadEvents.slice(i,i+NFC_BATCH_SIZE).map(payload=>({
        team_id:this.teamId,id:payload.id,payload
      }));
      const {error}=await this.supabase.from('nfc_agenda_events').insert(batch);
      if(error)throw new Error('Importação interrompida. Os dados locais continuam intactos. '+error.message);
    }
    for(let i=0;i<plan.toUploadClients.length;i+=NFC_BATCH_SIZE){
      const batch=plan.toUploadClients.slice(i,i+NFC_BATCH_SIZE).map(item=>({
        team_id:this.teamId,name_key:item.name_key,payload:item.payload
      }));
      const {error}=await this.supabase.from('nfc_agenda_clients').insert(batch);
      if(error)throw new Error('Clientes ainda não importados por completo. Seu backup local foi preservado. '+error.message);
    }
    return {eventsAdded:plan.toUploadEvents.length,clientsAdded:plan.toUploadClients.length};
  }
  async addEvent(record){
    await this.verifyMembership();
    if(!recordObject(record)||typeof record.id!=='string'||!record.id)throw new Error('Compromisso inválido.');
    const {data,error}=await this.supabase.from('nfc_agenda_events')
      .insert({team_id:this.teamId,id:record.id,payload:record})
      .select('id,payload,revision,updated_at').single();
    if(error)throw error;
    return data;
  }
  async updateEvent(record,expectedRevision){
    await this.verifyMembership();
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw new Error('Revisão inválida.');
    const {data,error}=await this.supabase.from('nfc_agenda_events')
      .update({payload:record})
      .eq('team_id',this.teamId).eq('id',record.id).eq('revision',expectedRevision)
      .select('id,payload,revision,updated_at').maybeSingle();
    if(error)throw error;
    if(!data)throw new Error('Este serviço foi alterado por outra pessoa. Atualize antes de editar.');
    return data;
  }
  async deleteEvent(id,expectedRevision){
    await this.verifyMembership();
    const {data,error}=await this.supabase.from('nfc_agenda_events').delete()
      .eq('team_id',this.teamId).eq('id',id).eq('revision',expectedRevision)
      .select('id').maybeSingle();
    if(error)throw error;
    if(!data)throw new Error('O serviço mudou em outro dispositivo. Atualize antes de excluir.');
    return true;
  }
  subscribeToEvents(onChange){
    // Requires explicit addition of the events table to supabase_realtime publication.
    return this.supabase.channel('nfc-agenda-'+this.teamId)
      .on('postgres_changes',{
        event:'*',schema:'public',table:'nfc_agenda_events',
        filter:'team_id=eq.'+this.teamId
      },onChange).subscribe();
  }
}
