import target_model as T
rows={r['ch']:r for r in T.channel_rows()}
att=lambda k: rows[k]['reg']*rows[k]['show']
base25={k:v['vis'] for k,v in T.B.items()}
ce='College Partnerships (contingent engine)'
A=att(ce)-base25[ce]
C=sum(att(k)-base25[k] for k in rows if k!=ce)
b=T.run('base'); s=T.run('stretch')
B_base=b['vis_showup']+b['vis_waitlist']; B_str=s['vis_showup']+s['vis_waitlist']
D=s['vis_squad']; E=s['walkins']-T.WALKINS_2025
print('A contingent',round(A,1),'C realloc peer',round(C,1),'A+C',round(A+C,1))
print('B base',round(B_base,1),'B stretch',round(B_str,1),'D',round(D,1),'E',E)
print('sum stretch',round(2050+A+C+B_str+D+E,1))
eff={'B':2,'A':6,'C':2,'D':3,'E':8}; conf={'B':0.7,'A':0.8,'C':0.8,'D':0.5,'E':0.3}
imp={'A':A,'B':B_str,'C':C,'D':D,'E':E}
for k in sorted(imp,key=lambda k:-imp[k]*conf[k]/eff[k]): print(k,round(imp[k]),conf[k],eff[k],round(imp[k]*conf[k]/eff[k],1))
for k in rows: print(k[:25], round(att(k)-base25[k],1))
print('marginal CPReg contingent', round(31000/450*T.MARGINAL_COST_MULT,1), '2x', round(31000/450*2,1))
print('weekly contingent regs over 10 wks', round(rows[ce]['reg']/10,1))
print('show rate base',round((b['total']-125)/b['reg_total'],4),'stretch reg-based', round((s['total']-425-s['vis_squad'])/(s['reg_total']-s['ident_total']+s['ident_total']-s['vis_squad']/T.SQUAD_SHOW) ,4))
print('blended realloc show',round(b['vis_realloc']/b['reg_total'],4))
