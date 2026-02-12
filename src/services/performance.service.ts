import { Injectable } from '@angular/core';
declare var XLSX: any;

@Injectable({
  providedIn: 'root'
})
export class PerformanceService {
  private scoringData = {
      'Positive Completion %': { 'T1': 0.90, 'T1_points': 4, 'T2': 0.93, 'T2_points': 4, 'T3': 0.95, 'T3_points': 5, 'lower_better': false, 'total_points': 13 },
      '7 Day Repeats IN/COS %': { 'T1': 0.06, 'T1_points': 5, 'T2': 0.055, 'T2_points': 5, 'T3': 0.045, 'T3_points': 5, 'lower_better': true, 'total_points': 15 },
      '7 Day Repeats TC %': { 'T1': 0.055, 'T1_points': 5, 'T2': 0.05, 'T2_points': 5, 'T3': 0.045, 'T3_points': 5, 'lower_better': true, 'total_points': 15 },
      '30 Day IN/COS Repeat %': { 'T1': 0.07, 'T1_points': 2, 'T2': 0.055, 'T2_points': 3, 'T3': 0.04, 'T3_points': 5, 'lower_better': true, 'total_points': 10 },
      '30 Day TC Repeat %': { 'T1': 0.09, 'T1_points': 2, 'T2': 0.08, 'T2_points': 3, 'T3': 0.07, 'T3_points': 5, 'lower_better': true, 'total_points': 10 },
      'On Time %': { 'T1': 0.93, 'T1_points': 2, 'T2': 0.95, 'T2_points': 2, 'T3': 0.96, 'T3_points': 4, 'lower_better': false, 'total_points': 8 },
      'NPS %': { 'T1': 0.60, 'T1_points': 3, 'T2': 0.70, 'T2_points': 3, 'T3': 0.80, 'T3_points': 6, 'lower_better': false, 'total_points': 12 },
      'OSAT': { 'T1': 0.0, 'T1_points': 0, 'T2': 0.0, 'T2_points': 0, 'T3': 9.0, 'T3_points': 5, 'lower_better': false, 'total_points': 5 },
      'TS %': { 'T1': 0.88, 'T1_points': 2, 'T2': 0.92, 'T2_points': 4, 'T3': 0.95, 'T3_points': 6, 'lower_better': false, 'total_points': 12 },
      'SMS Text Compliance %': { 'T1': 0.0, 'T1_points': 0, 'T2': 0.0, 'T2_points': 0, 'T3': 0.90, 'T3_points': 5, 'lower_better': false, 'total_points': 5 }
  };

  public getScoringKeys(): string[] {
    return Object.keys(this.scoringData);
  }

  private _processRow(row: any, allNumericKeys: Set<string>, foundColumnKeys: Set<string>): any {
    const newRow = { ...row };

    // Pass 1: REBUILT PARSING. Clean all values that are present in the file.
    // Invalid values are now set to NULL, not 0, to distinguish them from actual zero values.
    for (const key in newRow) {
        if (!Object.prototype.hasOwnProperty.call(newRow, key)) continue;

        const value = newRow[key];
        const isInvalid = value === null || value === undefined || value === '#DIV/0!' || value === '#N/A' || String(value).trim() === '';

        if (isInvalid) {
            newRow[key] = allNumericKeys.has(key) ? null : '';
            continue;
        }

        if (key.includes('%')) {
            let num = parseFloat(String(value).replace(/%/g, ''));
            if (!isNaN(num)) {
                if (num > 1 && num <= 100) { newRow[key] = num / 100; } 
                else if (num >= 0 && num <= 1) { newRow[key] = num; } 
                else { newRow[key] = null; } // Out of range is invalid (null, not 0)
            } else {
                newRow[key] = null; // Not a number string is invalid (null, not 0)
            }
        } else if (allNumericKeys.has(key)) {
            if (typeof value !== 'number') {
                const num = parseFloat(String(value));
                newRow[key] = isNaN(num) ? null : num; // Invalid numbers become null, not 0
            }
        }
    }

    // Pass 2: Calculate metrics ONLY IF the corresponding key does NOT exist on the row object yet.
    const calculationMap = [
        { percentKey: 'Positive Completion %', countKey: 'Closed', totalKey: 'Jobs' },
        { percentKey: '7 Day Repeats IN/COS %', countKey: '7 Day IN/COS Repeats', totalKey: 'Jobs' },
        { percentKey: '7 Day Repeats TC %', countKey: '7 Day TC Repeats', totalKey: 'Jobs' },
        { percentKey: '30 Day IN/COS Repeat %', countKey: '30 Day IN/COS Repeats', totalKey: 'Jobs' },
        { percentKey: '30 Day TC Repeat %', countKey: '30 Day TC Repeats', totalKey: 'Jobs' },
        { percentKey: 'NPS %', calc: () => (newRow['NPS Surveys'] > 0) ? ((newRow['NPS Promoters'] || 0) - (newRow['NPS Detractors'] || 0)) / newRow['NPS Surveys'] : undefined },
        { percentKey: 'OSAT', calc: () => (newRow['OSAT Count'] > 0) ? (newRow['OSAT Sum'] || 0) / newRow['OSAT Count'] : undefined },
        { percentKey: 'TS %', calc: () => (newRow['Techspeed Denominator'] > 0) ? (newRow['Techspeed Numerator'] || 0) / newRow['Techspeed Denominator'] : undefined },
        { percentKey: 'SMS Text Compliance %', calc: () => (newRow['SMS Total'] > 0) ? (newRow['SMS Compliant'] || 0) / newRow['SMS Total'] : undefined },
    ];
    
    try {
        for (const item of calculationMap) {
            if (newRow[item.percentKey] === undefined) { // Only if column was completely missing
                let calculatedValue: number | undefined = undefined;
                if (item.calc) {
                    calculatedValue = item.calc();
                } else if (item.countKey && item.totalKey) {
                    const total = newRow[item.totalKey];
                    const count = newRow[item.countKey];
                    if (total > 0 && count !== undefined && count !== null) {
                        calculatedValue = count / total;
                    }
                }
                if (calculatedValue !== undefined) {
                    newRow[item.percentKey] = calculatedValue;
                }
            }
        }
    } catch (e) {
        console.error("Error during metric calculation (Pass 2):", e);
    }

    // Pass 3: Final validation to ensure all scoring keys exist. If a key is still missing, set it to null.
    try {
        for (const key of Object.keys(this.scoringData)) {
            if (newRow[key] === undefined) {
                newRow[key] = null;
            }
        }
    } catch (e) {
        console.error("Error during final validation (Pass 3):", e);
    }

    return newRow;
  }

  parseAndCleanFile(file: File): Promise<{ technicians: any[], companyData: any | null, foundColumns: { [key: string]: string } }> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e: any) => {
            try {
                const workbook = XLSX.read(e.target.result, { type: 'array' });
                const techSheetName = workbook.SheetNames[0];
                if (!techSheetName) throw new Error("Excel file must contain at least one sheet.");

                const techWorksheet = workbook.Sheets[techSheetName];
                let techJsonData: any[] = XLSX.utils.sheet_to_json(techWorksheet, { defval: null });

                const keyColumns: { [key: string]: string[] } = {
                    'Tech #': ['Tech #', 'Tech', 'ID'], 'Name': ['Name', 'Technician', 'Tech Team'], 'Vendor': ['Vendor', 'Company'], 'Market': ['Market', 'Area'],
                    'Region': ['Region', 'Zone'], 'Tier': ['Tier', 'Level'], 'RANK': ['RANK', 'Rank'], 'TOTAL RATING': ['TOTAL RATING', 'Total Rating'],
                    'Positive Completion %': ['Positive Completion %', 'Pos Comp', 'Pos Completion'], 
                    '7 Day Repeats IN/COS %': ['7 Day Repeats IN/COS %', '7D Reps IN/COS', '7 Day Repeats IN/COS'], 
                    '7 Day Repeats TC %': ['7 Day Repeats TC %', '7D Reps TC', '7 Day Repeats TC'],
                    '30 Day IN/COS Repeat %': ['30 Day IN/COS Repeat %', '30D IN/COS Rep', '30 Day IN/COS Repeat'], 
                    '30 Day TC Repeat %': ['30 Day TC Repeat %', '30D TC Rep', '30 Day TC Repeat'], 
                    'On Time %': ['On Time %'], 
                    'TS %': ['TS %', 'TS', 'Techspeed'], 
                    'NPS %': ['NPS %', 'NPS'], 
                    'OSAT': ['OSAT'], 
                    'SMS Text Compliance %': ['SMS Text Compliance %', 'SMS', 'SMS Text Compliance'],
                    // Raw data for calculations
                    'Closed': ['Closed', 'Closed Jobs'], 
                    'Jobs': ['Jobs', 'Total TR'], 
                    "7 Day IN/COS Repeats": ["7 Day IN/COS Repeats", "Repeats"],
                    "7 Day IN/COS TR's": ["7 Day IN/COS TR's", "Truck Rolls"], 
                    "7 Day TC Repeats": ["7 Day TC Repeats", "Repeats"], 
                    "7 Day TC TR's": ["7 Day TC TR's", "Truck Rolls"],
                    "30 Day IN/COS Repeats": ["30 Day IN/COS Repeats", "Repeats"], 
                    "30 Day IN/COS Truck Rolls": ["30 Day IN/COS Truck Rolls", "Truck Rolls"],
                    "30 Day TC Repeats": ["30 Day TC Repeats", "Repeats"], 
                    "30 Day TC Truck Rolls": ["30 Day TC Truck Rolls", "Truck Rolls"],
                    'On Time Jobs': ['On Time Jobs', 'On Time Count', 'On Time'],
                    "On Time TR's": ["On Time TR's", 'On Time Truck Rolls', "Truck Rolls"],
                    'NPS Promoters': ['NPS Promoters', 'Promoters'],
                    'NPS Detractors': ['NPS Detractors', 'Detractors'],
                    'NPS Surveys': ['NPS Surveys', 'NPS Count', 'Total Surveys'],
                    'OSAT Sum': ['OSAT Sum', 'OSAT Total Score'],
                    'OSAT Count': ['OSAT Count', 'OSAT Surveys'],
                    'Techspeed Numerator': ['Techspeed Numerator', 'TS Num', 'TS Jobs', 'TS Usage'],
                    'Techspeed Denominator': ['Techspeed Denominator', 'TS Denom', 'TS Total Jobs', 'TS Required'],
                    'SMS Compliant': ['SMS Compliant', 'Button Pushes'],
                    'SMS Total': ['SMS Total', 'SMS Sent', 'Required SMS'],
                };

                const firstRow = techJsonData[0] || {};
                const fileHeaders = Object.keys(firstRow);
                const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

                const foundColumns: { [key: string]: string } = {};
                for (const stdName in keyColumns) {
                    for (const pattern of keyColumns[stdName]) {
                        const normalizedPattern = normalize(pattern);
                        const foundHeader = fileHeaders.find(h => normalize(h) === normalizedPattern);
                        if (foundHeader) {
                            foundColumns[stdName] = foundHeader;
                            break;
                        }
                    }
                }
                
                const foundColumnKeys = new Set(Object.keys(foundColumns));

                const techDataWithStandardKeys = techJsonData.map(row => {
                    const newRow: any = {};
                    for (const stdName in foundColumns) {
                        newRow[stdName] = row[foundColumns[stdName]];
                    }
                    return newRow;
                });
                
                const numericMetrics = new Set(Object.keys(this.scoringData));
                numericMetrics.add('TOTAL RATING');
                numericMetrics.add('RANK');
                const allNumericKeys = new Set([...numericMetrics, 'Closed', 'Jobs', "7 Day IN/COS Repeats", "7 Day IN/COS TR's", "7 Day TC Repeats", "7 Day TC TR's", "30 Day IN/COS Repeats", "30 Day IN/COS Truck Rolls", "30 Day TC Repeats", "30 Day TC Truck Rolls", 'On Time Jobs', "On Time TR's",
                    'NPS Promoters', 'NPS Detractors', 'NPS Surveys', 'OSAT Sum', 'OSAT Count',
                    'Techspeed Numerator', 'Techspeed Denominator', 'SMS Compliant', 'SMS Total'
                ]);

                const cleanedTechnicians = techDataWithStandardKeys.map(row => this._processRow(row, allNumericKeys, foundColumnKeys));
                
                let companyData: any | null = null;
                if (workbook.SheetNames.length > 1) {
                    const companySheetName = workbook.SheetNames[1];
                    const companyWorksheet = workbook.Sheets[companySheetName];
                    let companyJsonData: any[] = XLSX.utils.sheet_to_json(companyWorksheet, { defval: null });
                    
                    if (companyJsonData.length > 0) {
                        const companyRowFromFile = companyJsonData[0];
                        const companyRowWithStandardKeys: any = {};
                        for (const stdName in foundColumns) {
                           const fileHeader = foundColumns[stdName];
                           if (fileHeader && fileHeader in companyRowFromFile) {
                             companyRowWithStandardKeys[stdName] = companyRowFromFile[fileHeader];
                           }
                        }
                        companyData = this._processRow(companyRowWithStandardKeys, allNumericKeys, foundColumnKeys);
                    }
                }

                resolve({ technicians: cleanedTechnicians, companyData, foundColumns });

            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsArrayBuffer(file);
    });
  }

  calculatePerformance(techData: any, monthName: string) {
    let detailed: { [key: string]: any } = {};
    let total_points = 0;
    const scoringData:any = this.scoringData;

    for (const metric in scoringData) {
        if (Object.prototype.hasOwnProperty.call(techData, metric)) {
            // Skip metric if its value is null or undefined
            if (techData[metric] === null || techData[metric] === undefined) continue;
            
            try {
                const actual = parseFloat(techData[metric]);
                if(isNaN(actual)) continue;

                const goals = scoringData[metric];
                const lower_better = goals.lower_better || false;
                let points = 0;

                // Cumulative points logic: if a tech meets a tier, they get the points for that tier and all preceding tiers.
                if ((!lower_better && actual >= goals.T1) || (lower_better && actual <= goals.T1)) {
                    points += goals.T1_points;
                }
                if ((!lower_better && actual >= goals.T2) || (lower_better && actual <= goals.T2)) {
                    points += goals.T2_points;
                }
                if ((!lower_better && actual >= goals.T3) || (lower_better && actual <= goals.T3)) {
                    points += goals.T3_points;
                }
                
                detailed[metric] = { actual, points, max: goals.total_points };
                total_points += points;
                
            } catch {
                continue;
            }
        }
    }
    
    // Use TOTAL RATING from file if available and it's not null.
    if (techData['TOTAL RATING'] !== undefined && techData['TOTAL RATING'] !== null) {
        total_points = techData['TOTAL RATING'];
    }
    
    const detailedAsArray = Object.entries(detailed).map(([key, value]) => ({ key, value }));

    const totalMetrics = detailedAsArray.length;
    const maxMetrics = detailedAsArray.filter(item => item.value.points === item.value.max).length;

    const improvementOpportunities: any[] = [];
    for (const metric in scoringData) {
        if (Object.prototype.hasOwnProperty.call(techData, metric)) {
            if (techData[metric] === null || techData[metric] === undefined) continue;
            
            const actual = parseFloat(techData[metric]);
            if (isNaN(actual)) continue;

            const goals = scoringData[metric as keyof typeof scoringData];
            const lower_better = goals.lower_better || false;
            
            const all_tiers = [];
            for (let t = 1; t <= 3; t++) {
                const threshold = goals[`T${t}` as keyof typeof goals] as number;
                const tier_points = goals[`T${t}_points` as keyof typeof goals] as number;

                if (tier_points > 0) {
                     const goalMet = (lower_better && actual <= threshold) || (!lower_better && actual >= threshold);
                     if (!goalMet) {
                         all_tiers.push({
                            metric: metric,
                            tierLabel: `${metric.replace(/ %/g, '').replace('Positive ', 'Pos ').replace('SMS Text Compliance', 'SMS')} T${t}`,
                            target: threshold,
                            current: actual,
                            points_available: tier_points,
                            lower_better
                         });
                     }
                }
            }
            improvementOpportunities.push(...all_tiers);
        }
    }
    improvementOpportunities.sort((a,b) => b.points_available - a.points_available);
    
    const top3Priorities = improvementOpportunities.slice(0, 3);
      
    const max_possible = 105;
    return {
        detailed: detailedAsArray,
        total_points,
        max_possible,
        utilization: max_possible > 0 ? total_points / max_possible : 0,
        totalMetrics,
        maxMetrics,
        improvementOpportunities: improvementOpportunities.slice(0, 12),
        top3Priorities,
        monthName
    };
  }
}