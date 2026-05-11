const dummyFile1 = String.raw`description
	2 plague_bearer_gains_%_of_damage_from_inflicted_poisons plague_bearer_maximum_stored_poison_damage
	2
		# # table_only "Expected [Poison] damage stored (cap)@{0}% ({1})"
		# # "Stores {0}% of Expected [Poison] damage, up to {1}\nDeals [Physical] damage equal to the stored [Poison]"
	lang "German"
	2
		# # table_only "Gespeicherter erwarteter [Poison|Gift]schaden (max.)@{0}% ({1})"
		# # "Speichert {0}% des erwarteten [Poison|Gift]schadens, bis zu {1}\nVerursacht [Physical|physischen] Schaden in Höhe des gespeicherten [Poison|Gifts]"
	lang "Japanese"
	2
		# # table_only "貯められる期待[Poison|毒]ダメージ (上限)@{0}% ({1}%)"
		# # "期待[Poison|毒]ダメージの{0}%を貯める、最大{1}まで\n貯められた[Poison|毒]と同量の[Physical|物理]ダメージを与える"
	lang "Korean"
	2
		# # table_only "예상되는 [Poison|중독] 피해 저장량(한도)@{0}%({1})"
		# # "예상되는 [Poison|중독] 피해의 {0}% 저장, 최대 {1}\n저장된 [Poison|중독] 피해와 동일한 [Physical|물리] 피해를 줌"
	lang "Portuguese"
	2
		# # table_only "Dano de [Poison|veneno] esperado guardado (máximo)@{0}% ({1})"
		# # "Guarda {0}% de dano de [Poison|veneno] esperado, até {1}\nCausa dano [Physical|físico] equivalente ao [Poison|veneno] guardado"
	lang "Russian"
	2
		# # table_only "Ожидаемый сохраненный урон от [Poison|яда] (максимум)@{0}% ({1})"
		# # "Сохраняет {0}% от ожидаемого урона от [Poison|яда], вплоть до {1}\nНаносит [Physical|физический] урон, равный сохраненному урону от [Poison|яда]"
	lang "Spanish"
	2
		# # table_only "Daño de [Poison|veneno] esperado almacenado (límite)@{0}% ({1})"
		# # "Almacena el {0}% del daño de [Poison|veneno] esperado, hasta {1}\nInflige daño [Physical|físico] equivalente al [Poison|veneno] almacenado"
	lang "Thai"
	2
		# # table_only "ความเสียหายเต็มระยะเวลา ของสถานะ [Poison|พิษ] ที่กักเก็บ (สูงสุด)@{0}% ({1})"
		# # "กักเก็บ {0}% ของความเสียหาย [Poison|พิษ] เต็มระยะเวลา สูงสุด {1}\nสร้างความเสียหาย [Physical|กายภาพ] เท่ากับสถานะ [Poison|พิษ] ที่กักเก็บไว้"
	lang "Simplified Chinese"
	2
		# # table_only "储存预期[Poison|中毒]伤害（上限）@{0}%（{1}）"
		# # "储存预期[Poison|中毒]伤害的 {0}%，最多 {1}\n造成相当于储存[Poison|中毒]的[Physical|物理]伤害"
	lang "Traditional Chinese"
	2
		# # table_only "可儲存的預期[Poison|中毒]傷害（上限）@{0}% ({1})"
		# # "儲存 {0}% 預期[Poison|中毒]傷害，最多為 {1}\n造成等同於儲存的[Poison|中毒]傷害的[Physical|物理]傷害"
	lang "French"
	2
		# # table_only "Dégâts de [Poison|Poison] prévus enmmagasinés (plafond)@{0}% ({1})"
		# # "Emmagasine {0} % des Dégâts de [Poison|Poison] prévus, jusqu'à {1}\nInflige des Dégâts [Physical|Physiques] équivalents au [Poison|Poison] Emmagasiné"
`;

const dummyFile2 = String.raw`description
	1 unique_facebreaker_unarmed_attack_damage_+1%_final_per_X_strength
	2
		1|# "1% more [UnarmedDamage|Unarmed Damage] per {0} [Strength]"
		#|-1 "1% less [UnarmedDamage|Unarmed Damage] per {0} [Strength]" negate 1
`;

const dummyFile3 = String.raw`description
	1 enable_chakras
	1
		# "Can tattoo [Rune|Runes] onto your body, gaining\nadditional [Rune]-only sockets:\n• 1 Helmet socket\n• 2 Body Armour sockets\n• 1 Gloves socket\n• 1 Boots socket"
`;
