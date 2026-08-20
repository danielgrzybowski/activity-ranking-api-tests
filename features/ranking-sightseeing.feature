@rankings @scoring
Feature: Ranking sightseeing, indoors and out

  Outdoor sightseeing wants mild, dry, still weather. Indoor sightseeing is
  the fallback that always exists: a museum is open whatever the sky is
  doing. That asymmetry is a product decision, and it is what stops the app
  ever showing a user a day with four dead ends.

  Background:
    Given the Activity Ranking API is available
    And Open-Meteo's place catalogue contains the standard test cities

  @smoke
  Scenario: A clear 22C day is made for walking a city
    Given day 1 of the forecast for "Paris" is a "PERFECT_SUMMER_DAY"
    When I request rankings for location id "2988507"
    Then on day 1 "OUTDOOR_SIGHTSEEING" is rated "EXCELLENT"
    And on day 1 "OUTDOOR_SIGHTSEEING" is ranked 1
    And on day 1 the reasoning for "OUTDOOR_SIGHTSEEING" mentions one of "clear, sun, dry, 22"
    And on day 1 "INDOOR_SIGHTSEEING" is rated no better than "GOOD"

  Scenario: Cold rain sends people indoors
    Given day 1 of the forecast for "Paris" is a "COLD_RAIN_DAY"
    When I request rankings for location id "2988507"
    Then on day 1 "OUTDOOR_SIGHTSEEING" is rated no better than "POOR"
    And on day 1 "INDOOR_SIGHTSEEING" is ranked 1
    And on day 1 the reasoning for "OUTDOOR_SIGHTSEEING" mentions one of "rain, precipitation, wet"

  Scenario: A storm makes the outdoors unsuitable, not merely unpleasant
    Given day 1 of the forecast for "Paris" is a "STORM_DAY"
    When I request rankings for location id "2988507"
    Then on day 1 "OUTDOOR_SIGHTSEEING" is rated "UNSUITABLE"
    And on day 1 "INDOOR_SIGHTSEEING" is ranked 1

  # 39C is not "good weather" for walking around a city all day.
  Scenario: Extreme heat counts against outdoor sightseeing
    Given day 1 of the forecast for "Paris" is a "HEATWAVE_DAY"
    When I request rankings for location id "2988507"
    Then on day 1 "OUTDOOR_SIGHTSEEING" is rated no better than "FAIR"
    And on day 1 "INDOOR_SIGHTSEEING" is ranked above "OUTDOOR_SIGHTSEEING"
    And on day 1 the reasoning for "OUTDOOR_SIGHTSEEING" mentions one of "heat, hot, 39, temperature"

  Scenario: A grey, unremarkable day is fine without being a highlight
    Given day 1 of the forecast for "Paris" is a "MILD_OVERCAST_DAY"
    When I request rankings for location id "2988507"
    Then on day 1 "OUTDOOR_SIGHTSEEING" is rated between "FAIR" and "GOOD"
    And on day 1 no activity is rated "EXCELLENT"

  Scenario Outline: Outdoor sightseeing verdicts across representative days
    Given day 1 of the forecast for "Paris" is a "<profile>"
    When I request rankings for location id "2988507"
    Then on day 1 "OUTDOOR_SIGHTSEEING" is rated between "<lowest>" and "<highest>"

    Examples:
      | profile            | lowest     | highest    |
      | PERFECT_SUMMER_DAY | EXCELLENT  | EXCELLENT  |
      | CLEAN_SWELL_DAY    | GOOD       | EXCELLENT  |
      | FLAT_CALM_DAY      | GOOD       | EXCELLENT  |
      | MILD_OVERCAST_DAY  | FAIR       | GOOD       |
      | HEATWAVE_DAY       | POOR       | FAIR       |
      | COLD_RAIN_DAY      | UNSUITABLE | POOR       |
      | STORM_DAY          | UNSUITABLE | UNSUITABLE |
      | BLIZZARD           | UNSUITABLE | UNSUITABLE |

  # The contract's safety net: whatever the week throws at a city, the user
  # always has at least one workable suggestion per day.
  Scenario: Indoor sightseeing never drops below usable, whatever the weather
    Given the forecast for "Paris" is:
      | day | profile            |
      | 1   | STORM_DAY          |
      | 2   | BLIZZARD           |
      | 3   | COLD_RAIN_DAY      |
      | 4   | HEATWAVE_DAY       |
      | 5   | PERFECT_SUMMER_DAY |
      | 6   | MILD_OVERCAST_DAY  |
      | 7   | FLAT_CALM_DAY      |
    When I request rankings for location id "2988507"
    Then "INDOOR_SIGHTSEEING" is rated at least "FAIR" on every day
    And every day has at least one activity rated "FAIR" or better

  Scenario: Indoor sightseeing gains ground exactly when outdoors loses it
    Given day 1 of the forecast for "Paris" is a "PERFECT_SUMMER_DAY"
    And day 2 of the forecast for "Paris" is a "STORM_DAY"
    When I request rankings for location id "2988507"
    Then "INDOOR_SIGHTSEEING" scores higher on day 2 than on day 1
    And "OUTDOOR_SIGHTSEEING" scores higher on day 1 than on day 2
