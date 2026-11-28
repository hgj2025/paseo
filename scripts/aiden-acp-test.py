import importlib.util,pathlib,unittest,tempfile
p=pathlib.Path(__file__).with_name('aiden-acp.py')
s=importlib.util.spec_from_file_location('bridge',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
 def bridge(self):return m.CatalogBridge(self.tmp.name)
 def test_default_catalog_and_selection(self):
  b=self.bridge();b.from_client({'id':1,'method':'session/new','params':{}})
  r=b.from_agent({'id':1,'result':{'sessionId':'44444444-4444-4444-4444-444444444444'}})
  self.assertEqual(r['result']['models']['currentModelId'],m.MODEL)
  f,r=b.from_client({'id':2,'method':'session/set_model','params':{'sessionId':'44444444-4444-4444-4444-444444444444','modelId':m.MODEL}})
  self.assertIsNone(f);self.assertEqual(r['result'],{})
 def test_native_catalog_preserved(self):
  b=self.bridge();b.from_client({'id':1,'method':'session/new','params':{}})
  r={'id':1,'result':{'sessionId':'44444444-4444-4444-4444-444444444444','models':{'availableModels':[{'modelId':'actual'}]}}}
  self.assertEqual(b.from_agent(r),r);self.assertNotIn('44444444-4444-4444-4444-444444444444',b.default_sessions)
 def test_load_error_and_unknown_selection(self):
  b=self.bridge();b.from_client({'id':1,'method':'session/load','params':{'sessionId':'11111111-1111-1111-1111-111111111111'}})
  b.from_agent({'id':1,'result':{}});self.assertIn('11111111-1111-1111-1111-111111111111',b.default_sessions)
  f,r=b.from_client({'id':2,'method':'session/set_model','params':{'sessionId':'11111111-1111-1111-1111-111111111111','modelId':'other'}})
  self.assertIsNone(f);self.assertEqual(r['error']['code'],-32602)
 def test_notifications_and_failures_pass_through(self):
  b=self.bridge();r={'method':'session/update','params':{'sessionId':'44444444-4444-4444-4444-444444444444'}};self.assertIs(b.from_agent(r),r)
  b.from_client({'id':1,'method':'session/new','params':{}});r={'id':1,'error':{'code':-1}};self.assertIs(b.from_agent(r),r);self.assertFalse(b.default_sessions)
 def test_replay_after_native_history_missing(self):
  session='22222222-2222-2222-2222-222222222222';b=self.bridge()
  b.from_client({'id':1,'method':'session/prompt','params':{'sessionId':session,'prompt':[{'type':'text','text':'remember marker'}]}})
  b.from_agent({'method':'session/update','params':{'sessionId':session,'update':{'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':'unique-result'}}}})
  b.from_agent({'id':1,'result':{'stopReason':'end_turn'}})
  b=self.bridge();b.from_client({'id':2,'method':'session/load','params':{'sessionId':session}});b.from_agent({'id':2,'result':{}})
  f,_=b.from_client({'id':3,'method':'session/prompt','params':{'sessionId':session,'prompt':[{'type':'text','text':'recall'}]}})
  self.assertIn('unique-result',f['params']['prompt'][0]['text']);self.assertEqual(f['params']['prompt'][1]['text'],'recall')
  self.assertEqual(b.path(session).stat().st_mode & 0o777,0o600)
  self.assertEqual(b.replay_events[0]['params']['update']['sessionUpdate'],'user_message_chunk')
  self.assertEqual(b.replay_events[1]['params']['update']['content']['text'],'unique-result')
 def test_native_history_does_not_get_replayed_twice(self):
  session='33333333-3333-3333-3333-333333333333';b=self.bridge();b.history[session]=[{'role':'assistant','text':'prior'}];b.save(session)
  b=self.bridge();b.from_client({'id':1,'method':'session/load','params':{'sessionId':session}});b.from_agent({'id':1,'result':{'_meta':{'history':[{}]}}})
  self.assertNotIn(session,b.restore)
unittest.main()
