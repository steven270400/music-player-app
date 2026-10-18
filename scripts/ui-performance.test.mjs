import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackPresentation } from '../src/core/platform/playbackPresentation.ts';
import { createLibraryIndex, retainLibrarySnapshot, searchSongs } from '../src/features/library/libraryStore.ts';
import { retainNavigationContexts, pruneContexts } from '../src/features/library/navigationCache.ts';
import { afterVisualTransition, markVisualTransition } from '../src/ui/transitionWork.ts';

const song = (id, name=id) => ({songId:id,filename:name,title:null,artist:null,durationMs:10000,available:true,favourite:false,
 binding:{volume:'external_primary',providerVersion:'v',rowId:id,generationAdded:'1'}});
const nativeState = () => ({contractVersion:1,sessionId:'s',queueRevision:1,sequence:1,status:'playing',entries:[{entryId:'e1',song:song('1')},{entryId:'e2',song:song('1')}],
 originalOrder:['e1','e2'],playbackOrder:['e1','e2'],currentEntryId:'e1',positionMs:0,durationMs:10000,repeat:'off',shuffle:false,error:null});

test('200 progress events notify progress consumers without notifying the library or rebuilding Queue', () => {
 const store=createPlaybackPresentation();let renders=0,progress=0,queue=0;
 store.subscribePresentation(()=>renders++);store.subscribeProgress(()=>progress++);const remove=store.subscribeQueue(()=>queue++);
 store.publish(nativeState());const first=store.getPresentation(),entries=store.getQueue().entries;
 for(let i=1;i<=200;i++)store.publish({...structuredClone(nativeState()),sequence:i+1,positionMs:i*10});
 assert.equal(renders,1);assert.equal(progress,201);assert.equal(queue,1);assert.equal(store.getPresentation(),first);assert.equal(store.getQueue().entries,entries);
 assert.equal(store.getFull().sequence,201);assert.equal(store.getProgress().positionMs,2000);
 store.publish({...store.getFull(),sequence:202,currentEntryId:'e2',positionMs:0});
 assert.equal(renders,2);assert.equal(queue,2);assert.equal(store.getQueue().entries,entries,'duplicate song IDs keep independent queue entry identity');
 remove();store.publish({...store.getFull(),sequence:203,currentEntryId:'e1'});assert.equal(queue,2);
});
test('session/revision changes invalidate Queue while error/status updates remain visible',()=>{
 const store=createPlaybackPresentation();store.publish(nativeState());const initial=store.getQueue().entries;
 store.publish({...nativeState(),sequence:2,status:'paused'});assert.equal(store.getPresentation().status,'paused');assert.equal(store.getQueue().entries,initial);
 store.publish({...nativeState(),sequence:3,error:{code:'ACCESS_REQUIRED',message:'Permission required',retryable:true}});assert.equal(store.getPresentation().error.code,'ACCESS_REQUIRED');
 store.publish({...nativeState(),sequence:4,queueRevision:2,playbackOrder:['e2','e1'],shuffle:true});assert.deepEqual(store.getQueue().playbackOrder,['e2','e1']);assert.notEqual(store.getQueue().entries,initial);
 store.publish({...nativeState(),sessionId:'replacement',sequence:0});assert.equal(store.getPresentation().sessionId,'replacement');
});
test('library indexes preserve search semantics and invalidate changed committed state',()=>{
 const previous={songs:[song('1','Cafe\u0301 中文.mp3'),{...song('2','English.mp3'),artist:'Artist',favourite:true}],playlists:[{id:1,name:'List',songIds:['2','1']}]};
 assert.equal(retainLibrarySnapshot(previous,structuredClone(previous)),previous);
 const index=createLibraryIndex(previous);
 for(const query of ['', ' CAFÉ ', '中文', 'artist', 'nomatch'])assert.deepEqual(index.search(previous.songs,query),searchSongs(previous.songs,query));
 assert.deepEqual(index.playlistSongs.get(1).map(s=>s.songId),['2','1']);assert.ok(index.memberships.get(1).has('2'));
 const next=structuredClone(previous);next.songs[0].available=false;next.songs[1].favourite=false;next.songs[0].binding.providerVersion='changed';
 const changed=retainLibrarySnapshot(previous,next);assert.notEqual(changed,previous);assert.equal(changed.playlists,previous.playlists);
 const revised=createLibraryIndex(changed);assert.equal(revised.available.length,1);assert.equal(revised.favourites.length,0);
 const reordered=structuredClone(previous);reordered.playlists[0].songIds.reverse();assert.notEqual(retainLibrarySnapshot(previous,reordered).playlists,previous.playlists);
});
test('playlist navigation is LRU bounded and prunes deleted contexts without removing main tabs',()=>{
 const ids=Array.from({length:25},(_,i)=>i);let recent=[];
 for(const id of ids)recent=retainNavigationContexts(recent,`playlist-${id}`,ids).recent;
 assert.equal(recent.length,20);assert.equal(recent[0],'playlist-5');
 let retained=retainNavigationContexts(recent,'playlist-5',ids);assert.equal(retained.recent.at(-1),'playlist-5');
 retained=retainNavigationContexts(retained.recent,'songs',ids.filter(id=>id!==5));
 assert.deepEqual(pruneContexts({songs:'x','playlist-5':'deleted','playlist-24':'keep'},retained.allowed),{songs:'x','playlist-24':'keep'});
});
test('automatic work waits for motion, can be cancelled, and cannot starve beyond 500ms',()=>{
 const originalNow=Date.now,originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
 let now=0,id=0;const tasks=new Map();Date.now=()=>now;
 globalThis.setTimeout=(fn,delay)=>{tasks.set(++id,{fn,at:now+delay});return id;};globalThis.clearTimeout=key=>tasks.delete(key);
 const advance=to=>{while(true){const next=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>to)break;now=next[1].at;tasks.delete(next[0]);next[1].fn();}now=to;};
 try{let calls=0;markVisualTransition(240);afterVisualTransition(()=>calls++);advance(239);assert.equal(calls,0);advance(240);assert.equal(calls,1);
 const cancel=afterVisualTransition(()=>calls++);cancel();advance(300);assert.equal(calls,1);
 markVisualTransition(1000);afterVisualTransition(()=>calls++);advance(799);assert.equal(calls,1);advance(800);assert.equal(calls,2);
 }finally{Date.now=originalNow;globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});
