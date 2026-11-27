-- Plan layer: 2025 channel baselines (computed from the ORIGINAL data, frozen) and the 5 bets from Slides 2-3.
begin;
truncate channel_baseline;
insert into channel_baseline(campaign_id, cost_per_registrant_2025, show_rate_2025, ceiling_multiplier)
select campaign_id, cost_per_registrant, show_rate_pct,
  case when campaign_id = 'C02' then 1.0 else 1.5 end   -- Slide 3: paid retargeting stop line = 2025 paid average Rs 137
from f_channel_kpis(null, '2025');

update campaigns c set budget_2026_inr = b.v from (values
 ('C04',75000),('C01',60000),('C05',40000),('C06',25000),('C07',25000),('C02',30000),('C03',15000)) b(id,v)
where c.campaign_id = b.id;
update original.campaigns c set budget_2026_inr = p.budget_2026_inr from public.campaigns p where p.row_id = c.row_id;

truncate bets cascade;
insert into bets(bet_id,name,description,kpi_name,kpi_unit,base_attendees,stretch_attendees,budget_inr,owner_name,confidence,effort_weeks,score,scale_if,change_if,stop_if,action_text) values
(1,'Show-up programme + waitlist auto-release','Reminders at T-14/T-3/T-1, QR passes, daily waitlist release. 575 confirmed no-shows and 88 stranded waitlisted in 2025 [D].','QR passes downloaded / confirmed','%',139,202,30000,'CRM/ops lead',0.7,2,70.7,'>= 85% -> extend winning reminder variant','70-85% -> add WhatsApp and captain nudges','< 70%, or opt-outs > 6.5% of identified -> pause reminders','If paused: captain-led nudges only; waitlist release keeps running daily'),
(2,'Contingent engine','Formal invites via college sports committees across NCR, Haryana, Punjab with team registration. Best 2025 show rate 85.6% (College Partnerships) [D].','Cost per contingent registrant','INR',364,364,75000,'Partnerships lead',0.8,6,48.5,'<= Rs 103 and >= 88 registrants/week -> add colleges','Rs 103-138 -> narrow to top-converting colleges','> Rs 138 for 2 weeks -> move spend to referrals','Re-allocate weekly in the dashboard'),
(3,'Shift paid spend to peer channels','Paid Social Rs 93k -> 30k, Creators Rs 59k -> 15k; freed money funds bets 1-2 and peer channels. Rs 274-337 per paid attendee vs Rs 69-108 peer [D].','Cost per registrant by channel vs ceiling','INR',117,117,0,'Growth lead',0.8,2,46.8,'Below ceiling -> move more from paid','At ceiling -> hold','Paid retargeting > Rs 137 per registrant -> cut paid to zero','Shift money to the channel furthest below its ceiling'),
(4,'Squad referral','Contingent players invite friends; non-cash rewards [A]. Referrals cheapest channel in 2025 (Rs 69/attendee, 78.6% show) [D].','Referred registrants / contingent registrants','ratio',0,172,0,'Referrals lead',0.5,3,28.7,'>= 0.25 by T-4w -> roll out to all contingents','0.10-0.25 -> change the reward','< 0.10 after 2 weeks -> stop, drop from stretch','Swap reward type, re-test 1 week'),
(5,'Evening pro-nights + IPL screening','Sponsor-funded evening events in the OAT (2,000-2,500 seats [O]); 400 check-ins at 6 pm on day 1 in 2025 [D].','Pro-night RSVPs','count',0,300,0,'Events + sponsorship lead',0.3,8,11.3,'>= 300 RSVPs -> add second screening zone','150-300 -> push via contingents','No sponsor by T-6w -> drop screening, keep DJ night','Cap RSVPs at OAT capacity');
commit;
