import pandas as pd, numpy as np, sys
pd.set_option('display.width',250)
A=pd.read_excel(sys.argv[1],sheet_name=None)
camp=A['Campaigns'].set_index('campaign_id').campaign_name
P=A['People'].drop_duplicates()
assert P.person_id.is_unique
ext=P[P.person_type=='external']; E=set(ext.person_id)
print('PEOPLE by type',P.person_type.value_counts().to_dict(),'| external by first touch',ext.first_touch_source.value_counts().to_dict())
R=A['Registrations'].drop_duplicates()
print('regs rows',len(R),'unique reg ids',R.registration_id.nunique(),'persons',R.person_id.nunique(),'persons w/ >1 reg',(R.person_id.value_counts()>1).sum())
print('reg person types',P.set_index('person_id').loc[R.person_id].person_type.value_counts().to_dict())
RE=R[R.person_id.isin(E)]
H=A['Registration History'].drop_duplicates('history_id').sort_values(['effective_at','history_id'])
last=H.groupby('registration_id').tail(1).set_index('registration_id').status
RE=RE.assign(status=RE.registration_id.map(last))
C=A['Check-ins'].drop_duplicates('event_id')
V=C[(C.result=='admitted')&(C.verification=='verified')&C.person_id.isin(E)]
vis=set(V.person_id)
print('verified ext visitors',len(vis),'| of which registered',len(vis&set(RE.person_id)),'| walk-in/no reg',len(vis-set(RE.person_id)))
print('admission events per visitor', V.groupby('person_id').size().value_counts().to_dict())
print('days attended', V.assign(d=V.occurred_at.dt.date).groupby('person_id').d.nunique().value_counts().to_dict())
print('non-ext admitted verified',C[(C.result=='admitted')&(C.verification=='verified')&~C.person_id.isin(E)].person_id.nunique())
print('denied ppl',C[C.result=='denied'].person_id.nunique(),'pending ppl',C[C.result=='pending'].person_id.nunique(), 'pending ppl never verified', len(set(C[C.result=='pending'].person_id)-vis))
RE=RE.assign(attended=RE.person_id.isin(vis))
print('\nFINAL STATUS x ATTENDED (external registrants)'); print(pd.crosstab(RE.status,RE.attended,margins=True))
D=A['Daily Marketing'].drop_duplicates('activity_id')
print('\nspend total',D.marketing_spend_inr.sum(),'neg rows',(D.marketing_spend_inr<0).sum(), D.marketing_spend_inr[D.marketing_spend_inr<0].sum())
I=A['Interest and Engagement'].drop_duplicates('interaction_id')
idp=ext.groupby('first_campaign_id').person_id.nunique()
g=D.groupby('campaign_id')[['impressions','clicks','landing_page_sessions','registration_starts','marketing_spend_inr']].sum()
g['identified']=idp
g['registered']=RE.groupby('campaign_id').person_id.nunique()
g['confirmed']=RE[RE.status=='confirmed'].groupby('campaign_id').person_id.nunique()
g['cancelled']=RE[RE.status=='cancelled'].groupby('campaign_id').person_id.nunique()
g['attended_reg']=RE[RE.attended].groupby('campaign_id').person_id.nunique()
g['visitors_ci']=V.drop_duplicates('person_id').groupby('campaign_id').person_id.nunique()
g['id->reg%']=100*g.registered/g.identified
g['reg->att%']=100*g.attended_reg/g.registered
g['cancel%']=100*g.cancelled/g.registered
g['CPReg']=g.marketing_spend_inr/g.registered
g['CPVisitor']=g.marketing_spend_inr/g.attended_reg
g['optouts']=I[I.event_type=='opted_out'].groupby('campaign_id').person_id.nunique()
g.index=g.index.map(camp)
print(g.round(1).to_string())
tot=g.sum(numeric_only=True); print('TOTAL identified',tot.identified,'reg',tot.registered,'att_reg',tot.attended_reg,'spend',tot.marketing_spend_inr,'CPV',round(tot.marketing_spend_inr/tot.attended_reg,1))
# timing
RE['wk']=RE.registered_at.dt.to_period('W-SUN')
print('\nregistrations by week'); print(RE.groupby('wk').size().to_string())
RE['lead_days']=(pd.Timestamp('2025-04-12')-RE.registered_at.dt.normalize()).dt.days
RE['lb']=pd.cut(RE.lead_days,[-1,7,14,30,60,200])
print(pd.crosstab(RE.lb,RE.attended,normalize='index').round(3))
print(RE.lb.value_counts().sort_index().to_dict())
D['wk']=pd.to_datetime(D.activity_date).dt.to_period('W-SUN'); print('\nspend by week'); print(D.groupby('wk').marketing_spend_inr.sum().to_string())
T=A['Targets']; print(T.to_string())
print('spend before 15 Mar', D[pd.to_datetime(D.activity_date)<'2025-03-15'].marketing_spend_inr.sum())
