"""Small reproducible historical thyroid classification benchmark.

Dataset-native numerical scale ONLY: source units are not documented. This
model must not receive clinical FT4/FT3 values or unverified laboratory units.
"""
from pathlib import Path
import argparse, hashlib, json, platform, shutil
import numpy as np
import pandas as pd
import sklearn
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler, FunctionTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_validate
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, confusion_matrix, classification_report, roc_auc_score

FEATURES=['TSH','TT4','T3']
CLASS_KEYS=['no_comment','hypothyroid_group','hyperthyroid_group']
CLASS_NAMES=['Без состояния, требующего комментария','Гипотиреоидная группа','Гипертиреоидная группа']

def write(path,obj):
    Path(path).write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')

def class_counts(y):
    return {CLASS_KEYS[i]:int(np.sum(np.asarray(y)==i)) for i in range(3)}

def scores(y,prob):
    pred=prob.argmax(axis=1)
    return dict(accuracy=float(accuracy_score(y,pred)),balanced_accuracy=float(balanced_accuracy_score(y,pred)),f1_macro=float(f1_score(y,pred,average='macro')),f1_weighted=float(f1_score(y,pred,average='weighted')),roc_auc_macro_ovr=float(roc_auc_score(y,prob,multi_class='ovr',average='macro')),confusion_matrix=confusion_matrix(y,pred,labels=[0,1,2]).tolist(),class_report=classification_report(y,pred,labels=[0,1,2],target_names=CLASS_KEYS,output_dict=True,zero_division=0),correct=int(np.sum(y==pred)),test_size=len(y))

def export_model(model,name):
    out={'schema_version':1,'model_version':'thyrolab-historical-labs-v1','model_name':name,'feature_names':FEATURES,'class_ids':[0,1,2],'class_keys':CLASS_KEYS,'class_names':CLASS_NAMES,'usage':'dataset_examples_only','clinical_mapping_supported':False,'units':{'TSH':'source-native numerical scale; unit not documented','TT4':'source-native TOTAL T4 scale; unit not documented','T3':'source-native T3 scale; unit not documented'},'score_semantics':'uncalibrated classification score on historical dataset; not disease risk','eligibility':{'age_min':18,'age_max':100,'pregnant':False,'on_thyroxine':False,'on_antithyroid_meds':False,'all_three_labs_measured':True,'target_codes':['-']+list('ABCDEFGH')},'label_note':''}
    out['label_note']='Original target - means no condition requiring comment, not confirmed healthy. A-D and E-H are grouped historical comments.'
    if isinstance(model,RandomForestClassifier):
        out['type']='random_forest';out['trees']=[]
        for tree in model.estimators_:
            t=tree.tree_;v=t.value[:,0,:];v=v/np.maximum(v.sum(axis=1,keepdims=True),1e-300)
            out['trees'].append({'left':t.children_left.tolist(),'right':t.children_right.tolist(),'feature':t.feature.tolist(),'threshold':t.threshold.tolist(),'probability':v.tolist()})
        out['parameters']={'n_estimators':64,'max_depth':5,'class_weight':'balanced','random_state':42}
    else:
        out['type']='logistic_regression';sc=model.named_steps['scale'];lr=model.named_steps['lr']
        out.update(transform='log1p',mean=sc.mean_.tolist(),scale=sc.scale_.tolist(),coef=lr.coef_.tolist(),intercept=lr.intercept_.tolist())
        out['parameters']={'C':1.0,'class_weight':'balanced','max_iter':3000,'random_state':42}
    return out

def json_predict(model,X):
    result=[]
    for row in X:
        if model['type']=='random_forest':
            p=np.zeros(3)
            for t in model['trees']:
                node=0
                while t['left'][node]!=-1:
                    # sklearn trees cast input to float32 before comparisons.
                    value=float(np.float32(row[t['feature'][node]]))
                    node=t['left'][node] if value<=t['threshold'][node] else t['right'][node]
                p+=np.array(t['probability'][node])
            p/=len(model['trees'])
        else:
            z=(np.log1p(row)-np.array(model['mean']))/np.array(model['scale'])
            logits=np.array(model['coef'])@z+np.array(model['intercept']);p=np.exp(logits-logits.max());p/=p.sum()
        result.append(p)
    return np.array(result)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--data',required=True);ap.add_argument('--out',default='results');args=ap.parse_args()
    out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
    source=Path(args.data);df=pd.read_csv(source);df['source_row']=np.arange(len(df))
    filters=[('age18_100',df.age.between(18,100)),('nonpregnant',df.pregnant.eq('f')),('no_thyroxine',df.on_thyroxine.eq('f')),('no_antithyroid_meds',df.on_antithyroid_meds.eq('f')),('unambiguous_target',df.target.isin(['-']+list('ABCDEFGH'))),('complete_labs',df[FEATURES].notna().all(axis=1)),('measured_labs',df[['TSH_measured','TT4_measured','T3_measured']].eq('t').all(axis=1)),('nonnegative_finite_labs',(df[FEATURES].ge(0)&np.isfinite(df[FEATURES])).all(axis=1))]
    keep=pd.Series(True,index=df.index);filter_log=[]
    for name,mask in filters:
        before=int(keep.sum());keep &= mask;filter_log.append({'filter':name,'before':before,'after':int(keep.sum()),'removed':before-int(keep.sum())})
    eligible=df.loc[keep].copy();eligible['class_id']=eligible.target.map(lambda s:0 if s=='-' else (1 if s in 'EFGH' else 2))
    grouped=eligible.groupby(FEATURES,dropna=False,sort=False)
    conflicting=[];retained=[];identical_rows_removed=0
    for _,g in grouped:
        if g.class_id.nunique()>1:
            conflicting.append({'source_rows':g.source_row.astype(int).tolist(),'class_ids':g.class_id.astype(int).tolist()});continue
        first=g.iloc[0].copy();first['source_rows']=','.join(map(str,g.source_row.astype(int)));retained.append(first);identical_rows_removed+=len(g)-1
    clean=pd.DataFrame(retained).sort_values('source_row').reset_index(drop=True)
    X=clean[FEATURES].to_numpy(float);y=clean.class_id.to_numpy(int)
    train,test=train_test_split(np.arange(len(clean)),test_size=.30,random_state=42,stratify=y)
    train=np.sort(train);test=np.sort(test);clean['split']='train';clean.loc[test,'split']='test'
    clean[['source_row','source_rows','patient_id','age','sex','pregnant','on_thyroxine','on_antithyroid_meds']+FEATURES+['target','class_id','split']].to_csv(out/'split_manifest.csv',index=False)
    candidates={'Logistic regression':Pipeline([('log',FunctionTransformer(np.log1p)),('scale',StandardScaler()),('lr',LogisticRegression(C=1.0,class_weight='balanced',max_iter=3000,random_state=42))]),'Random Forest':RandomForestClassifier(n_estimators=64,max_depth=5,class_weight='balanced',random_state=42,n_jobs=2)}
    cv=StratifiedKFold(n_splits=5,shuffle=True,random_state=42)
    cv_results={}
    for name,model in candidates.items():
        r=cross_validate(model,X[train],y[train],cv=cv,scoring={'f1_macro':'f1_macro','balanced_accuracy':'balanced_accuracy'},n_jobs=1)
        cv_results[name]={'f1_macro_mean':float(r['test_f1_macro'].mean()),'f1_macro_std':float(r['test_f1_macro'].std()),'balanced_accuracy_mean':float(r['test_balanced_accuracy'].mean()),'fold_scores':r['test_f1_macro'].tolist()}
        print('CV',name,json.dumps(cv_results[name]),flush=True)
    winner=max(cv_results,key=lambda name:cv_results[name]['f1_macro_mean'])
    evaluated=[];probabilities={}
    for name,model in candidates.items():
        model.fit(X[train],y[train]);p=model.predict_proba(X[test]);probabilities[name]=p
        evaluated.append({'name':name,'selected':name==winner,'train_cv':cv_results[name],**scores(y[test],p)})
    chosen=candidates[winner];exported=export_model(chosen,winner)
    parity=json_predict(exported,X[test]);maxdiff=float(np.max(np.abs(parity-probabilities[winner])))
    assert maxdiff<1e-10, maxdiff
    assert np.array_equal(parity.argmax(axis=1),probabilities[winner].argmax(axis=1))
    write(out/'model.json',exported)
    p=probabilities[winner];pred=p.argmax(axis=1)
    predictions=clean.loc[test,['source_row','patient_id']+FEATURES+['target','class_id']].copy()
    predictions['prediction']=pred
    for i,key in enumerate(CLASS_KEYS):predictions['score_'+key]=p[:,i]
    predictions.to_csv(out/'test_predictions.csv',index=False)
    demos=[];rng=np.random.default_rng(42)
    for cls in range(3):
        offsets=np.flatnonzero(y[test]==cls)
        # One typical correct example and one error if available (otherwise random).
        correct=[i for i in offsets if pred[i]==cls];errors=[i for i in offsets if pred[i]!=cls]
        selected=[]
        if correct:selected.append(int(rng.choice(correct)))
        pool=errors if errors else [int(i) for i in offsets if int(i) not in selected]
        if pool:selected.append(int(rng.choice(pool)))
        for i in selected:
            row=clean.iloc[test[i]];demos.append({'id':f'uci_{int(row.source_row)}','title':f'Пример {len(demos)+1:02d}','source':'UCI thyroid0387 via Hugging Face','split':'test','values':{f:float(row[f]) for f in FEATURES},'age':int(row.age),'pregnant':False,'on_thyroxine':False,'on_antithyroid_meds':False,'true_class_id':int(row.class_id),'true_class_key':CLASS_KEYS[int(row.class_id)],'original_target':row.target,'reference_prediction':int(pred[i]),'reference_scores':p[i].tolist(),'is_error':bool(pred[i]!=row.class_id)})
    write(out/'examples.json',{'usage':'dataset_examples_only','feature_names':FEATURES,'class_names':CLASS_NAMES,'examples':demos})
    audit={'raw_rows':len(df),'eligible_before_dedup':len(eligible),'filter_log':filter_log,'identical_same_class_rows_removed':identical_rows_removed,'conflicting_feature_groups_removed':len(conflicting),'conflicting_rows_removed':sum(len(x['source_rows']) for x in conflicting),'final_unique_feature_rows':len(clean),'class_counts':class_counts(y),'train_size':len(train),'test_size':len(test),'train_class_counts':class_counts(y[train]),'test_class_counts':class_counts(y[test]),'unit_of_split':'unique laboratory feature vector, not proven independent patient','patient_independence_established':False}
    write(out/'audit.json',audit);write(out/'conflicting_groups.json',conflicting)
    metrics={'task':'Historical unambiguous diagnostic-comment groups using TSH, total T4 and T3','usage':'dataset_examples_only','units_verified':False,'selected_model':winner,'selection':'Highest mean macro F1 in 5-fold CV on training portion only; two fixed candidates','split':{'seed':42,'train_fraction':.70,'test_fraction':.30,'stratified':True,'test_used_for_selection':False},'class_names':CLASS_NAMES,'class_keys':CLASS_KEYS,'feature_names':FEATURES,'models':evaluated,'audit':audit,'export_parity':{'test_rows_checked':len(test),'max_absolute_probability_difference':maxdiff,'all_class_predictions_equal':True},'limitations':['Historical selected complete cases; no external clinical validation.','Record identifiers are not documented as patient identifiers.','Source does not document physical units sufficiently for clinical mapping.','No free T4 or free T3 is present; do not substitute them.','Scores are uncalibrated and are not patient disease risks.','No-comment class is not equivalent to confirmed healthy.']}
    write(out/'metrics.json',metrics)
    provenance={'dataset_hf':'https://huggingface.co/datasets/anasmakki/thyroid_disease_dataset','hf_file':'thyroidDF (1).csv','primary_source':'https://archive.ics.uci.edu/dataset/102/thyroid+disease','doi':'10.24432/C5D010','primary_source_license':'CC BY 4.0','hf_mirror_license_metadata':'not supplied; primary-source attribution retained','source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'source_verified_against_uci':hashlib.sha256(source.read_bytes()).hexdigest()=='17bfe20da369ef710c5bea26fdec8b0210a32e628621cbbe1537e6607b1c544e','field_mismatches_in_9172_rows':0 if hashlib.sha256(source.read_bytes()).hexdigest()=='17bfe20da369ef710c5bea26fdec8b0210a32e628621cbbe1537e6607b1c544e' else None,'versions':{'python':platform.python_version(),'numpy':np.__version__,'pandas':pd.__version__,'scikit-learn':sklearn.__version__},'training_features':FEATURES,'feature_units':'Not documented by primary .names; no clinical mapping asserted','pretrained_model':False,'note':'This is our fitted sklearn model on a verified Hugging Face dataset, not a pretrained Hugging Face model.'}
    write(out/'provenance.json',provenance)
    print('FINAL',json.dumps({'winner':winner,'audit':audit,'models':[{k:v for k,v in m.items() if k not in ['class_report','train_cv']} for m in evaluated],'parity':maxdiff},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
